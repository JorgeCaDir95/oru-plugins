---
name: sync
description: Sync a bridge connector (Figma) into Oru — reads it via Claude Code's own MCP connection and pushes changed documents to Oru's index. Use after /oru:setup has connected a connector, or any time to refresh it incrementally.
arguments: [connector]
user-invocable: true
---

Sync `$connector` into Oru (default to `figma` — the only bridge connector today; `all` means every bridge-connected connector):

1. Call the `orubrain` MCP server's `get_setup_status` tool. If the requested connector isn't `connected`, stop and tell the user to run `/oru:setup` first.
2. Call `get_sync_state` for the connector to see what Oru already has (totals, pending, failed, last sync time) and its saved `sources` — the Figma files to re-read. If there are none, ask the user for the links to the files that matter and save them with `add_sources`.
3. Launch the `oru-indexer` subagent for the connector, passing it that sync-state snapshot so it can skip documents that are already up to date.
4. When the subagent finishes, call `get_sync_state` again and report a summary: files, scanned, changed, indexed, failed, images kept, and mention that running this twice in a row with nothing changed will index zero new documents (content-hash dedup).

Never call `ingest_source`/`ingest_batch`/`ingest_asset` directly from this skill — that is the subagent's job, so a large sync runs in its own context instead of flooding this conversation.
