#!/usr/bin/env node
import { findAgyHost, prepareAgyIdentity, readAgySession, syncAgySession, waitForAgySession } from "./native-session.mjs";
import { createWakeBridge } from "./native-wake.mjs";

const host = findAgyHost();
const session = await waitForAgySession(host);
const preserveId = prepareAgyIdentity(host, session);
const { runtimeReady } = await import("@ctliz/agent-intercom-claude/dist/claude-server.mjs");
const runtime = await runtimeReady;
const wake = createWakeBridge({ runtime, host });
let syncing = false;
const timer = setInterval(() => {
  if (syncing) return;
  syncing = true;
  void syncAgySession(runtime, readAgySession(host), preserveId).then(() => wake.tick()).catch(error => {
    process.stderr.write(`agy-intercom: ${error.message}\n`);
  }).finally(() => { syncing = false; });
}, 250);
timer.unref();
const stop = () => { clearInterval(timer); wake.stop(); };
process.stdin.once("end", stop);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("exit", stop);
