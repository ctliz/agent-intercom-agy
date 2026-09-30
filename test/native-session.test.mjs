import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { agyMetadataPath, findAgyHost, prepareAgyIdentity, publishAgySession, readAgySession, syncAgySession, waitForAgySession } from "../bin/native-session.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "agy-native-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const host = { pid: 42, startedAt: "Wed Sep 30 12:34:56 2026" };
  const env = { PI_CODING_AGENT_DIR: dir };
  const save = (name = "AGY 审查 🚀", nativeId = "native-agy-a") => publishAgySession({
    conversation_id: nativeId, conversation_title: name, cwd: dir,
  }, host, env);
  return { dir, host, env, save };
}

test("native title producer writes private metadata only, never another broker owner", t => {
  const f = fixture(t); f.save();
  const record = readAgySession(f.host, f.env);
  assert.equal(record.nativeId, "native-agy-a");
  assert.equal(record.name, "AGY 审查 🚀");
  assert.deepEqual(readdirSync(join(f.dir, "intercom")), ["agy-host-42.json"]);
  if (process.platform !== "win32") {
    assert.equal(statSync(agyMetadataPath(f.host, f.env)).mode & 0o777, 0o600);
    assert.equal(statSync(join(f.dir, "intercom")).mode & 0o777, 0o700);
  }
});

test("stale PID reuse, malformed and oversized records cannot bind another session", t => {
  const f = fixture(t); f.save();
  assert.equal(readAgySession({ ...f.host, startedAt: "different process" }, f.env), undefined);
  const path = agyMetadataPath(f.host, f.env);
  for (const raw of ["null", "{}", "{", "x".repeat(65537)]) {
    writeFileSync(path, raw);
    assert.equal(readAgySession(f.host, f.env), undefined);
  }
  assert.equal(findAgyHost(process.pid), undefined);
});

test("native ID/title seed startup and all launcher identity aliases retain precedence", t => {
  const f = fixture(t); f.save();
  const session = readAgySession(f.host, f.env);
  const env = { ...f.env };
  assert.equal(prepareAgyIdentity(f.host, session, env), false);
  assert.equal(env.AGENT_INTERCOM_SESSION_ID, "agy-native-agy-a");
  assert.equal(env.CLAUDE_INTERCOM_NAME, "AGY 审查 🚀");
  assert.equal(env.PWD, f.dir);
  for (const key of ["CLAUDE_INTERCOM_SESSION_ID", "CLAUDE_PEER_ID", "AGENT_INTERCOM_SESSION_ID"]) {
    const env = { ...f.env, [key]: "pane-42" };
    assert.equal(prepareAgyIdentity(f.host, session, env), true);
    assert.equal(env[key], "pane-42");
    if (key !== "AGENT_INTERCOM_SESSION_ID") assert.equal(env.AGENT_INTERCOM_SESSION_ID, undefined);
  }
});

test("fallback host identities survive MCP restart without choosing a recent conversation", t => {
  const f = fixture(t);
  const first = { ...f.env }, second = { ...f.env };
  prepareAgyIdentity(f.host, undefined, first);
  prepareAgyIdentity(f.host, undefined, second);
  assert.equal(first.AGENT_INTERCOM_SESSION_ID, second.AGENT_INTERCOM_SESSION_ID);
  const reused = { ...f.env };
  prepareAgyIdentity({ ...f.host, startedAt: "later AGY process" }, undefined, reused);
  assert.notEqual(first.AGENT_INTERCOM_SESSION_ID, reused.AGENT_INTERCOM_SESSION_ID);
});

test("rename changes presence on the same owner and never blanks a known title", async t => {
  const f = fixture(t); f.save("first");
  let identity = { sessionId: "agy-native-agy-a", name: "first", cwd: f.dir, model: "agy", startedAt: 1 };
  const updates = [];
  const runtime = { getIdentity: () => identity, syncSession: async next => { updates.push(next); identity = next; } };
  f.save("renamed");
  await syncAgySession(runtime, readAgySession(f.host, f.env), false);
  f.save("");
  await syncAgySession(runtime, readAgySession(f.host, f.env), false);
  assert.equal(updates.length, 1);
  assert.equal(identity.sessionId, "agy-native-agy-a");
  assert.equal(identity.name, "renamed");
  f.save("switched", "native-agy-b");
  await syncAgySession(runtime, readAgySession(f.host, f.env), true);
  assert.equal(identity.sessionId, "agy-native-agy-a");
  assert.equal(identity.name, "switched");
  await syncAgySession(runtime, readAgySession(f.host, f.env), false);
  assert.equal(identity.sessionId, "agy-native-agy-b");
});

test("startup waits for a racing native title callback", async t => {
  const f = fixture(t);
  const timer = setTimeout(() => f.save(), 10);
  t.after(() => clearTimeout(timer));
  assert.equal((await waitForAgySession(f.host, f.env, 200)).nativeId, "native-agy-a");
  assert.equal(await waitForAgySession(undefined, f.env), undefined);
});

test("publisher can preserve a user's existing renderer input byte-for-byte", () => {
  const input = '{"conversation_id":"test","conversation_title":"测试 🚀","cwd":"/tmp"}\n';
  const command = fileURLToPath(new URL("../bin/agent-intercom-agy-title.mjs", import.meta.url));
  const passthrough = spawnSync(process.execPath, [command, "--passthrough"], { input, encoding: "utf8" });
  assert.equal(passthrough.status, 0);
  assert.equal(passthrough.stdout, input);
  const rendered = spawnSync(process.execPath, [command], { input, encoding: "utf8" });
  assert.equal(rendered.status, 0);
  assert.equal(rendered.stdout, "AGY · 测试 🚀\n");
});
