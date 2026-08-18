# Agent Intercom for AGY

A minimal native AGY plugin that starts `claude-intercom-mcp` as an MCP server.
It gives AGY the Agent Intercom tools: `intercom_whoami`, `intercom_list`,
`intercom_send`, `intercom_pending`, and related tools.

## Requirements

`claude-intercom-mcp` must be installed and available on `PATH`:

```bash
command -v claude-intercom-mcp
```

This plugin uses the shared Agent Intercom broker, normally at
`~/.pi/agent/intercom/broker.sock`.

## Install

```bash
agy plugin validate /Users/tsiji/Documents/intercom/agent-intercom-agy
agy plugin install /Users/tsiji/Documents/intercom/agent-intercom-agy
```

Restart AGY after installation. The plugin's `mcp_config.json` runs:

```text
claude-intercom-mcp
```

with these environment variables:

- `CLAUDE_INTERCOM_SESSION_ID`
- `CLAUDE_INTERCOM_NAME`
- `CLAUDE_INTERCOM_MODEL`

## Identity

The supplied values are deliberately static:

```json
{
  "CLAUDE_INTERCOM_SESSION_ID": "agy-worker",
  "CLAUDE_INTERCOM_NAME": "agy-worker",
  "CLAUDE_INTERCOM_MODEL": "agy"
}
```

Before enabling another AGY worker, change all three values, especially the
session ID. A static ID is valid for **one worker only**; two live workers with
the same ID collide at the broker.

## Delivery behavior

This plugin provides MCP tools, not an AGY wake bridge. An inbound
`intercom_send` does **not** automatically create an AGY prompt or wake an idle
AGY session. Keep the AGY session open and call `intercom_pending` at natural
boundaries to read inbound messages. Use `intercom_send` for normal messages;
do not use `intercom_ask` when the receiver cannot actively poll and reply.

## Quick check

In a live AGY session, ask it to call `intercom_whoami`, then
`intercom_list`. To test incoming delivery, have another Agent Intercom peer
send a nonce and ask AGY to call `intercom_pending`.
