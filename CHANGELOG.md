# Changelog

## 0.3.0 - 2026-10-05

- Add automatic incoming notifications through AGY CLI's native `agentapi send-message`, sharing the sole MCP broker owner. Batch bursts, preserve sender/team/reply selectors and attachments, and avoid injecting old messages into a different conversation.
- Add a once-per-conversation `PreInvocation` bootstrap and `agent-intercom-agy-wake bind` command to capture native endpoint credentials from AGY's tool environment, with normal permissions, loopback validation, and private PID/start-time-bound storage.
- Retain unread messages on native submission failure, throttle retries, and document native acknowledgement ambiguity, polling fallback, and the shared runtime's lack of inbox restoration across MCP restarts.

## 0.2.1 - 2026-10-04

- Bundle an automatically loaded AGY rule for the shortest safe Intercom calling path: send directly to known recipients, read only the selected tool definition when required, and discover peers or diagnose connection status only when needed. Preserve team approval, reply threading, and polling-only delivery.

## 0.1.2 - 2026-09-30

- Upgrade the shared Claude MCP runtime to 0.14.1 for eager registration and named teams.
- Add a metadata-only native `title` callback (`agent-intercom-agy-title`), bound to the exact parent AGY PID and process start time. It does not claim a broker connection and can preserve an existing renderer's input with `--passthrough`.
- Use native conversation IDs when metadata is available, preserve explicit launcher IDs, and synchronize native renames without changing the ID. Without the optional callback, use a unique, reconnect-stable host identity rather than guessing a recent conversation.
- Keep incoming-message delivery polling-only; AGY's turn-level Stop hook is not treated as SessionEnd.

## 0.1.1 - 2026-08-24

- Publish the AGY plugin as `@ctliz/agent-intercom-agy`.
- Bundle a dedicated MCP launcher backed by `@ctliz/agent-intercom-claude`.
- Keep inbound delivery polling-based through `intercom_pending`.

## 0.1.0 - 2026-08-18

- Add the initial GitHub-distributed AGY plugin.
