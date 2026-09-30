#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { findAgyHost, publishAgySession } from "./native-session.mjs";

let raw = "", title = "AGY";
try {
  raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("AGY title payload is too large");
  const input = JSON.parse(raw);
  if (typeof input?.conversation_title === "string" && input.conversation_title.trim()) {
    title = `AGY · ${input.conversation_title.trim()}`;
  }
  publishAgySession(input, findAgyHost());
} catch (error) {
  process.stderr.write(`agy-intercom title: ${error.message}\n`);
}
// Pipe --passthrough to a pre-existing renderer to retain its exact JSON input.
process.stdout.write(process.argv.includes("--passthrough") ? raw : title.replace(/[\x00-\x1f\x7f]/g, " ") + "\n");
