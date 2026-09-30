#!/usr/bin/env node
import { findAgyHost, prepareAgyIdentity, readAgySession, syncAgySession, waitForAgySession } from "./native-session.mjs";

const host = findAgyHost();
const session = await waitForAgySession(host);
const preserveId = prepareAgyIdentity(host, session);
const { runtimeReady } = await import("@ctliz/agent-intercom-claude/dist/claude-server.mjs");
const runtime = await runtimeReady;
let syncing = false;
const timer = setInterval(() => {
  if (syncing) return;
  syncing = true;
  void syncAgySession(runtime, readAgySession(host), preserveId).catch(error => {
    process.stderr.write(`agy-intercom: ${error.message}\n`);
  }).finally(() => { syncing = false; });
}, 250);
timer.unref();
process.stdin.once("end", () => clearInterval(timer));
process.once("SIGTERM", () => clearInterval(timer));
process.once("exit", () => clearInterval(timer));
