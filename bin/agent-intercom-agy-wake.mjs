#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { findAgyHost } from "./native-session.mjs";
import { bindAgyWake, wakeBootstrap } from "./native-wake.mjs";

const hook = process.argv[2] === "hook";
try {
  const host = findAgyHost();
  if (hook) {
    const raw = readFileSync(0, "utf8");
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("Hook payload is too large");
    process.stdout.write(JSON.stringify(wakeBootstrap(JSON.parse(raw), host)) + "\n");
  } else if (process.argv[2] === "bind") {
    bindAgyWake(host);
    process.stdout.write("Intercom automatic incoming notifications are bound to this AGY session.\n");
  } else {
    throw new Error("Usage: agent-intercom-agy-wake bind|hook");
  }
} catch (error) {
  process.stderr.write(`agy-intercom wake: ${error.message}\n`);
  if (hook) process.stdout.write("{}\n"); // Setup failure must not break the user's model turn.
  else process.exitCode = 1;
}
