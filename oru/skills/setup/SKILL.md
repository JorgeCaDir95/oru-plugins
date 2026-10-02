---
name: setup
description: Run Oru's setup — an interactive checklist that detects which sources are connected (Figma, Google Drive, Microsoft 365, Slack), lets you tick what to connect, signs in to each, and indexes what you choose into Oru.
user-invocable: true
---

Invoke the `setup` prompt exposed by the `orubrain` MCP server (it appears under `/mcp` once the server is connected) and follow it exactly, step by step. Do not re-implement the wizard here — the prompt is the source of truth and can change server-side without a plugin update.

If the `orubrain` MCP server is not connected yet, it is listed under `/mcp` as needing authentication: call its authenticate tool (or tell the user to open `/mcp` → orubrain → **Authenticate**) and have them sign in with their Orubrain account. With an access key instead, run `claude mcp add -s user --transport http orubrain https://orubrain.com/api/mcp --header "Authorization: Bearer $ORUBRAIN_MCP_TOKEN"`.
