import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindAgyWake, createWakeBridge, formatWake, readWakeBinding, sendNativeWake, wakeBootstrap, wakePath } from "../bin/native-wake.mjs";
import { readAgySession } from "../bin/native-session.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "agy-wake-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const host = { pid: 42, startedAt: "Mon Oct 5 00:00:00 2026" };
  const env = { PI_CODING_AGENT_DIR: dir, ANTIGRAVITY_CONVERSATION_ID: "native-a",
    ANTIGRAVITY_LS_ADDRESS: "localhost:12345", ANTIGRAVITY_CSRF_TOKEN: "private-token", ANTIGRAVITY_AGENTAPI_EXE: "/bin/agy" };
  const input = { conversationId: "native-a", workspacePaths: [dir] };
  return { dir, host, env, input };
}

test("hook asks once for binding, seeds native identity, and stores credentials privately", t => {
  const f = fixture(t);
  assert.match(wakeBootstrap(f.input, f.host, f.env).injectSteps[0].ephemeralMessage, /agent-intercom-agy-wake bind/);
  assert.equal(readAgySession(f.host, f.env).nativeId, "native-a");
  assert.deepEqual(wakeBootstrap(f.input, f.host, f.env), {});
  bindAgyWake(f.host, f.env);
  const binding = readWakeBinding(f.host, "native-a", f.env);
  assert.equal(binding.token, "private-token");
  assert.deepEqual(wakeBootstrap(f.input, f.host, f.env), {});
  if (process.platform !== "win32") assert.equal(statSync(wakePath(f.host, f.env)).mode & 0o777, 0o600);
  assert.equal(readWakeBinding(f.host, "other-conversation", f.env), undefined);
  assert.equal(readWakeBinding({ ...f.host, startedAt: "reused PID" }, "native-a", f.env), undefined);
  assert.ok(wakeBootstrap({ ...f.input, conversationId: "native-b" }, f.host, f.env).injectSteps);
  assert.throws(() => bindAgyWake(f.host, f.env), /does not match/);
});

test("binding fails closed without the owning CLI, native ID, credentials, or loopback address", t => {
  const f = fixture(t);
  wakeBootstrap(f.input, f.host, f.env);
  assert.throws(() => bindAgyWake(undefined, f.env), /inside the AGY CLI/);
  for (const address of ["example.com:1234", "localhost:99999", "http://localhost:1234", "localhost:1234/path", "127.0.0.1:0"]) {
    assert.throws(() => bindAgyWake(f.host, { ...f.env, ANTIGRAVITY_LS_ADDRESS: address }), /authenticated/);
  }
  assert.throws(() => bindAgyWake(f.host, { ...f.env, ANTIGRAVITY_CSRF_TOKEN: "" }), /authenticated/);
  assert.deepEqual(wakeBootstrap(f.input, undefined, f.env), {});
  writeFileSync(wakePath(f.host, f.env), "null");
  assert.equal(readWakeBinding(f.host, "native-a", f.env), undefined);
});

function message(id, team = "launch") {
  return { contextId: `ctx-${id}`, from: { id: "sender", name: "front" }, text: `message ${id}`, team,
    attachments: [{ type: "snippet", name: "code", content: "const n = 1;" }] };
}
function bridgeFixture() {
  let time = 0, session = { nativeId: "native-a" }, binding = { nativeId: "native-a" };
  let pending = [], fail = false;
  const sent = [], errors = [];
  const runtime = { getIdentity: () => ({ sessionId: "stable-launcher-id" }),
    pending: async markRead => { assert.equal(markRead, false); return { structuredContent: { unread_messages: pending } }; } };
  const bridge = createWakeBridge({ runtime, host: { pid: 42 }, now: () => time,
    readSession: () => session, readBinding: id => binding?.nativeId === id ? binding : undefined,
    send: async (b, text) => { if (fail) throw new Error("not available"); sent.push({ nativeId: b.nativeId, text }); },
    report: message => errors.push(message) });
  return { bridge, sent, errors, add: m => pending.push(m), advance: n => { time += n; },
    unbind: () => { binding = undefined; }, bind: () => { binding = session; }, fail: v => { fail = v; },
    switch: id => { session = { nativeId: id }; binding = session; } };
}

test("new messages automatically batch, preserve mixed teams/attachments/selectors and wake once", async () => {
  const f = bridgeFixture();
  f.add(message("1")); await f.bridge.tick();
  f.advance(200); f.add({ ...message("2", "review"), askId: "ask-2" }); await f.bridge.tick();
  f.advance(300); await f.bridge.tick();
  assert.equal(f.sent.length, 1);
  for (const value of ["launch", "review", "ctx-1", "ask-2", "const n = 1;", "intercom_reply"]) assert.ok(f.sent[0].text.includes(value));
  f.advance(1000); await f.bridge.tick();
  assert.equal(f.sent.length, 1);
  f.add(message("3")); await f.bridge.tick(); f.advance(300); await f.bridge.tick();
  assert.equal(f.sent.length, 2);
});

test("unbound and transient failures retain unread messages; retries are bounded", async () => {
  const f = bridgeFixture();
  f.unbind(); f.add(message("1")); await f.bridge.tick(); f.advance(1000); await f.bridge.tick();
  assert.equal(f.sent.length, 0);
  f.bind(); f.fail(true); await f.bridge.tick();
  assert.equal(f.errors.length, 1);
  f.advance(1000); await f.bridge.tick(); assert.equal(f.errors.length, 1);
  f.fail(false); f.advance(30000); await f.bridge.tick();
  assert.equal(f.sent.length, 1);
});

test("native switches with a stable launcher ID never forward stale unread messages", async () => {
  const f = bridgeFixture();
  f.add(message("old")); await f.bridge.tick();
  f.switch("native-b"); f.advance(500); await f.bridge.tick();
  assert.equal(f.sent.length, 0);
  f.add(message("new")); await f.bridge.tick(); f.advance(300); await f.bridge.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].nativeId, "native-b");
  assert.ok(!f.sent[0].text.includes("ctx-old"));
  f.bridge.stop(); f.add(message("after-stop")); f.advance(1000); await f.bridge.tick();
  assert.equal(f.sent.length, 1);
});

test("sustained incoming traffic cannot postpone wake past one second", async () => {
  const f = bridgeFixture();
  for (let i = 0; i <= 10; i++) { f.add(message(String(i))); await f.bridge.tick(); f.advance(100); }
  assert.equal(f.sent.length, 1);
});

test("in-flight native delivery cannot overlap with another tick", async () => {
  let release;
  let calls = 0;
  let time = 0;
  const bridge = createWakeBridge({ host: { pid: 42 },
    runtime: { getIdentity: () => ({ sessionId: "agy-a" }), pending: async () => ({ structuredContent: { unread_messages: [message("1")] } }) },
    readSession: () => ({ nativeId: "a" }), readBinding: () => ({ nativeId: "a" }), now: () => time,
    send: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  await bridge.tick(); time = 500;
  const first = bridge.tick();
  await new Promise(resolve => setImmediate(resolve));
  await bridge.tick();
  assert.equal(calls, 1);
  release(); await first; await bridge.tick();
  assert.equal(calls, 1);
});

test("large payloads wake with exact selectors and fetch full text through pending instead of truncation", () => {
  const text = formatWake([{ ...message("big"), text: "x".repeat(100000) }]);
  assert.match(text, /Call intercom_pending once/);
  assert.match(text, /ctx-big/);
  assert.ok(text.length < 2000);
});

test("native command uses literal args, private auth env, and checks JSON errors even on exit zero", { skip: process.platform === "win32" }, async t => {
  const f = fixture(t);
  const executable = join(f.dir, "agy");
  const output = join(f.dir, "args.json");
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({args: process.argv.slice(2), token: process.env.ANTIGRAVITY_CSRF_TOKEN}));
console.log(JSON.stringify({response: {sendMessage: {recipientId: process.argv[5]}}}));
`);
  chmodSync(executable, 0o700);
  const binding = { executable, nativeId: "native-a", address: "localhost:12345", token: "secret" };
  await sendNativeWake(binding, "$(touch should-not-exist)\n'quoted'");
  const observed = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(observed.token, "secret");
  assert.deepEqual(observed.args, ["agentapi", "send-message", "--title=Intercom", "native-a", "$(touch should-not-exist)\n'quoted'"]);
  writeFileSync(executable, '#!/usr/bin/env node\nconsole.log(JSON.stringify({error:"authentication failed"}));\n');
  await assert.rejects(sendNativeWake(binding, "hello"), /did not acknowledge/);
});
