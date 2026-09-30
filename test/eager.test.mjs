import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function until(read, accept) {
  for (let n = 0; n < 100; n++) {
    const value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error("Timed out waiting for AGY presence");
}

function rpc(child) {
  let buffer = "", id = 0;
  const pending = new Map();
  child.stdout.on("data", data => {
    buffer += data;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const packet = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(packet.id)?.(packet.result);
      pending.delete(packet.id);
    }
  });
  return (name, args = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("MCP RPC timeout")); }, 3000);
    pending.set(requestId, result => { clearTimeout(timer); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
}

// The fixture has the real process topology (agy -> title shell/MCP), not an
// override that lets production code trust arbitrary PIDs. It runs no model.
const hostCode = `
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const [inputPath,titlePath,mcpPath]=process.argv.slice(1);
let previous='';
function render(){
  const next=readFileSync(inputPath,'utf8');
  if(next===previous)return;
  const result=spawnSync(process.execPath,[titlePath],{input:next,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr);
  previous=next;
}
render();
const child=spawn(process.execPath,[mcpPath],{stdio:['pipe','inherit','inherit']});
process.stdin.pipe(child.stdin);
const timer=setInterval(render,50);
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>{clearInterval(timer);process.exit(code??0)});
`;

for (const launcherId of ["", "stable-tmux-pane"]) {
  test(`AGY native callback registers eagerly and renames the sole owner (${launcherId || "native ID"})`,
    { timeout: 20000, skip: process.platform === "win32" }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-mcp-eager-"));
    const cwd = join(dir, "workspace");
    mkdirSync(cwd);
    const executable = join(dir, "agy");
    try { linkSync(process.execPath, executable); } catch { copyFileSync(process.execPath, executable); }
    chmodSync(executable, 0o755);
    const inputPath = join(dir, "native-input.json");
    const title = name => writeFileSync(inputPath, JSON.stringify({ conversation_id: "native-agy-session", conversation_title: name, cwd }));
    title("AGY initial");
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir, AGENT_INTERCOM_SCOPE_ID: "",
      AGENT_INTERCOM_SESSION_ID: launcherId, CLAUDE_INTERCOM_SESSION_ID: "", CLAUDE_PEER_ID: "", CLAUDE_INTERCOM_INBOX: "" };
    const server = fileURLToPath(import.meta.resolve("@ctliz/agent-intercom-claude/dist/claude-server.mjs"));
    const brokerPath = fileURLToPath(import.meta.resolve("@ctliz/agent-intercom-claude/dist/broker.mjs"));
    const titlePath = fileURLToPath(new URL("../bin/agent-intercom-agy-title.mjs", import.meta.url));
    const mcpPath = fileURLToPath(new URL("../bin/agent-intercom-agy-mcp.mjs", import.meta.url));
    const children = [];
    try {
      const broker = spawn(process.execPath, [brokerPath], { cwd, env });
      children.push(broker);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Broker startup timeout")), 5000);
        broker.stdout.on("data", data => { if (String(data).includes("Intercom broker started")) { clearTimeout(timer); resolve(); } });
        broker.once("exit", () => { clearTimeout(timer); reject(new Error("Broker exited")); });
      });
      const probe = spawn(process.execPath, [server], { cwd, env: { ...env, CLAUDE_INTERCOM_SESSION_ID: "agy-probe", CLAUDE_INTERCOM_NAME: "probe" } });
      children.push(probe);
      const request = rpc(probe);
      const list = async () => (await request("intercom_list")).structuredContent.sessions;
      const startHost = () => {
        const child = spawn(executable, ["--input-type=module", "-e", hostCode, inputPath, titlePath, mcpPath], { cwd, env });
        children.push(child); return child;
      };
      const owner = startHost();
      const expectedId = launcherId || "agy-native-agy-session";
      const initial = await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "AGY initial"));
      assert.equal(initial.find(peer => peer.id === expectedId).model, "agy");
      // No initialize or tool request was sent to the owner.
      title("AGY renamed 🚀");
      await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "AGY renamed 🚀"));
      assert.equal((await request("intercom_send", { to: expectedId, message: "before first prompt" })).isError, undefined);
      await stop(owner);
      await until(list, peers => !peers.some(peer => peer.id === expectedId));
      startHost();
      await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "AGY renamed 🚀"));
    } finally {
      for (const child of children.reverse()) await stop(child);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
