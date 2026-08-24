# Agent Intercom for AGY

A minimal AGY plugin that exposes the nine Agent Intercom MCP tools through a dedicated launcher backed by `@ctliz/agent-intercom-claude`.

## Install

Install the npm package globally so the launcher is on `PATH`:

```bash
npm install -g @ctliz/agent-intercom-agy
command -v agent-intercom-agy-mcp
```

Install the AGY plugin from its exact release tag:

```bash
git clone --depth 1 --branch v0.1.1 https://github.com/ctliz/agent-intercom-agy.git
agy plugin validate ./agent-intercom-agy
agy plugin install ./agent-intercom-agy
```

Restart AGY, then call `intercom_whoami` and `intercom_list`. For an existing local checkout, run `npm install` before validating and installing it.

## Identity

The plugin supplies `CLAUDE_INTERCOM_MODEL=agy` but deliberately does not set a session ID or name. A multi-pane supervisor must provide literal, unique values for every worker:

```text
AGENT_INTERCOM_SESSION_ID=<stable-unique-worker-id>
AGENT_INTERCOM_SESSION_NAME=<display-name>
```

`CLAUDE_INTERCOM_SESSION_ID` and `CLAUDE_INTERCOM_NAME` remain higher-priority compatibility aliases. Concurrent sessions may not share an Intercom ID. Use the same `AGENT_INTERCOM_SCOPE_ID` as intended peers, or leave it unset for the default local scope.

## Delivery behavior

This package provides MCP tools, not an AGY wake bridge. Incoming messages remain durable but do not start a new AGY turn. Call `intercom_pending` at natural work boundaries. Use `intercom_send` for ordinary messages; use `intercom_ask` only when the receiver is actively polling and able to reply.
