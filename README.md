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
- **brings your Google Drive folders into Oru** (Docs, Sheets, Slides, PDFs, Word, Excel and
  PowerPoint), read-only, with the Google token kept on your machine,
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
| `oru/skills/setup` | Links the folder to a project, detects Figma and Google Drive, picks what to index |
| `oru/skills/drive` | Reads Google Drive read-only through `scripts/drive.mjs` and sends the text to Oru |
| `oru/skills/sync` | Re-syncs the saved Figma files and Drive folders, only what changed |
| `oru/agents/oru-indexer.md` | Subagent that reads Figma or Drive and sends what changed to Oru |
| `oru/scripts/drive.mjs` | Dependency-free Google Drive reader: `login`, `status`, `list`, `read`, `logout` |
| `oru/hooks/hooks.json` | Claude Code: states the folder at session start, adds Oru context to each prompt |
| `oru/CLAUDE-FRAGMENT.md`, `oru/AGENTS-FRAGMENT.md` | Optional lines for your project's `CLAUDE.md` / `AGENTS.md` |

The per-prompt context hook calls Oru outside the MCP session, so it needs an access key
(orubrain.com → Agents → Advanced). Enter it in the plugin's optional **Oru access key** setting,
which Claude Code keeps in your system's secure storage; an `ORUBRAIN_MCP_TOKEN` already set in your
shell still works. Without a key the hook stays silent and the agent still reaches Oru through the MCP.

Codex: the plugin's hooks are not wired yet; Oru leads there through the server's instructions
and `AGENTS-FRAGMENT.md`.

## Google Drive

Oru learns from Drive the same way it learns from Figma: your agent reads the folders you choose on
your machine and sends their text to Oru. Oru never receives your Google credentials and keeps no
copy of your files, only what it indexes from their text.

`scripts/drive.mjs` signs in with Google's **read-only** Drive permission and stores the token in
`~/.oru/google-drive.json` (readable only by you). `logout` revokes it.

It needs a Google OAuth client of type **Desktop app**, with the Google Drive API and Google Sheets
API enabled, saved as `~/.oru/google-oauth-client.json` (the JSON Google Cloud lets you download).
Until Orubrain's own client is verified by Google, an unverified client works for up to 100 test
users you add on its consent screen.

| File | Read as |
| --- | --- |
| Google Docs | Markdown |
| Google Sheets, Excel | CSV, one section per sheet |
| Google Slides, PowerPoint | Text, one section per slide |
| Word | Text |
| PDF | Handed to your agent, which reads it |
| Images, video, other binaries | Skipped |

## Develop

```bash
claude plugin validate ./ && claude plugin validate ./oru
node --test oru/scripts/drive-lib.test.mjs
claude plugin marketplace add ./   # install from your local checkout
```
