import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);

// MCP and title scripts are children of the same AGY CLI. Only traverse the
// renderer's launcher shells, never another agent or a session in the same cwd.
export function findAgyHost(pid = process.ppid) {
  for (let n = 0; pid > 1 && n < 16; n++) {
    let parts;
    try {
      parts = execFileSync("ps", ["-p", String(pid), "-o", "ppid=", "-o", "lstart=", "-o", "comm="],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" } }).trim().split(/\s+/);
    } catch { return undefined; }
    const command = basename(parts.slice(6).join(" "));
    if (/^agy(?:\.exe)?$/i.test(command)) return { pid, startedAt: parts.slice(1, 6).join(" ") };
    if (!/^(sh|bash|zsh|dash|fish)$/.test(command)) return undefined;
    pid = Number(parts[0]);
  }
  return undefined;
}

export function agyMetadataPath(host, env = process.env) {
  const agentDir = env.PI_CODING_AGENT_DIR?.trim()
    ? resolve(env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent");
  return join(agentDir, "intercom", `agy-host-${host.pid}.json`);
}

export function readAgySession(host, env = process.env) {
  if (!host) return undefined;
  try {
    const path = agyMetadataPath(host, env);
    if (statSync(path).size > 64 * 1024) return undefined;
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.hostStartedAt !== host.startedAt || !validId(record.nativeId)
      || typeof record.cwd !== "string" || !record.cwd.trim()
      || (record.name !== undefined && typeof record.name !== "string")) return undefined;
    return record;
  } catch { return undefined; }
}

// AGY's native title/statusLine input is snake_case. This producer writes
// metadata only: it must never connect to the broker or claim a session ID.
export function publishAgySession(input, host, env = process.env) {
  if (!host || !validId(input?.conversation_id) || typeof input.cwd !== "string" || !input.cwd.trim()) return;
  const path = agyMetadataPath(host, env);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const record = { hostStartedAt: host.startedAt, nativeId: input.conversation_id, cwd: input.cwd,
    ...(typeof input.conversation_title === "string" && input.conversation_title.trim()
      ? { name: input.conversation_title.trim() } : {}) };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}

export async function waitForAgySession(host, env = process.env, timeoutMs = 1500) {
  if (!host) return undefined;
  const deadline = Date.now() + timeoutMs;
  do {
    const session = readAgySession(host, env);
    if (session) return session;
    await delay(50);
  } while (Date.now() < deadline);
  return undefined;
}

export function prepareAgyIdentity(host, session, env = process.env, cwd = process.cwd()) {
  env.CLAUDE_INTERCOM_MODEL ??= "agy";
  const preserveId = [env.CLAUDE_INTERCOM_SESSION_ID, env.CLAUDE_PEER_ID, env.AGENT_INTERCOM_SESSION_ID].some(value => value?.trim());
  if (!preserveId) {
    const fallback = host ? `${host.pid}-${createHash("sha256").update(host.startedAt).digest("hex").slice(0, 8)}` : String(process.pid);
    env.AGENT_INTERCOM_SESSION_ID = `agy-${session?.nativeId || fallback}`;
  }
  if (!env.AGENT_INTERCOM_SESSION_NAME?.trim()) env.AGENT_INTERCOM_SESSION_NAME = `agy-${basename(session?.cwd || cwd)}-${host?.pid || process.pid}`;
  if (session?.name) env.CLAUDE_INTERCOM_NAME = session.name;
  if (session?.cwd) env.PWD = session.cwd;
  return preserveId;
}

export async function syncAgySession(runtime, session, preserveId) {
  if (!session) return;
  const identity = runtime.getIdentity();
  const next = { ...identity, sessionId: preserveId ? identity.sessionId : `agy-${session.nativeId}`,
    name: session.name?.trim() || identity.name, cwd: session.cwd };
  if (next.sessionId !== identity.sessionId || next.name !== identity.name || next.cwd !== identity.cwd) {
    await runtime.syncSession(next);
  }
}
