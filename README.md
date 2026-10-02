# Oru plugins

[Oru](https://orubrain.com) is your team's shared brain for business, brand and design. This
repository is a plugin marketplace for **Claude Code** and **Codex** with one plugin, **`oru`**.

With it installed, your coding agent:

- **checks Oru first on every task** — brand rules, design tokens, past decisions — without you
  having to mention it,
- **saves what it learns** back to Oru, so the next session, a teammate, or orubrain.com already
  knows it,
- **links each folder to an Oru project** once, for the whole team,
- **brings your Figma files into Oru** (screens, colors, type, components and their images),
- **gives you a preview link** for any design it makes, instead of writing files into your project
  until you ask for code.

## Install

**Claude Code**

```bash
claude plugin marketplace add JorgeCaDir95/oru-plugins
claude plugin install oru@orubrain
```

Start Claude Code, open `/mcp`, choose **orubrain** → **Authenticate**, and sign in with your
Orubrain account. Then ask: *"run Oru's setup"*.

**Codex**

```bash
codex plugin marketplace add JorgeCaDir95/oru-plugins
```

Open `/plugins` in Codex, install **oru**, and sign in when asked.

**Just the server, without the plugin** — any MCP client:

```bash
claude mcp add -s user --transport http orubrain https://orubrain.com/api/mcp
codex mcp add orubrain --url https://orubrain.com/api/mcp && codex mcp login orubrain
```

Cursor and VS Code have one-click install buttons on orubrain.com → **Agents**.

## What's inside

| Path | What it does |
| --- | --- |
| `oru/.mcp.json`, `oru/mcp.json` | The `orubrain` MCP server (Claude Code / Codex) |
| `oru/skills/oru` | How to work through Oru: context first, learnings saved, preview-first design |
| `oru/skills/setup` | Links the folder to a project, detects Figma, picks the files to index |
| `oru/skills/sync` | Re-syncs the saved Figma files |
| `oru/agents/oru-indexer.md` | Subagent that reads Figma and sends frames and images to Oru |
| `oru/hooks/hooks.json` | Claude Code: states the folder at session start, adds Oru context to each prompt |
| `oru/CLAUDE-FRAGMENT.md`, `oru/AGENTS-FRAGMENT.md` | Optional lines for your project's `CLAUDE.md` / `AGENTS.md` |

The per-prompt context hook calls Oru outside the MCP session, so it needs an access key
(orubrain.com → Agents → Advanced). Enter it in the plugin's optional **Oru access key** setting,
which Claude Code keeps in your system's secure storage; an `ORUBRAIN_MCP_TOKEN` already set in your
shell still works. Without a key the hook stays silent and the agent still reaches Oru through the MCP.

Codex: the plugin's hooks are not wired yet; Oru leads there through the server's instructions
and `AGENTS-FRAGMENT.md`.

## Develop

```bash
claude plugin validate ./ && claude plugin validate ./oru
claude plugin marketplace add ./   # install from your local checkout
```
