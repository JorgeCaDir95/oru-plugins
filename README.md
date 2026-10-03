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
- **brings your Microsoft 365 files into Oru** (OneDrive, SharePoint and Teams files), read-only,
- **brings the Slack channels you pick into Oru** (never direct messages),
- **saves your Claude Code conversations to Oru** (your private project chat, no tool output, secrets
  stripped), so what you decide while working becomes context too,
- **sets all of it up as a checklist**: it detects what is connected, you tick what to connect, and
  it signs in to each one,
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
| `oru/skills/setup` | Links the folder to a project; a checklist that detects, connects and indexes each source |
| `oru/skills/drive` | Reads Google Drive read-only through `scripts/drive.mjs` and sends the text to Oru |
| `oru/skills/microsoft` | Reads OneDrive, SharePoint and Teams files read-only through `scripts/microsoft.mjs` |
| `oru/skills/conversations` | Signs this machine in to Oru and saves this agent's conversations; pause with "don't save this" |
| `oru/skills/slack` | Reads the Slack channels you pick through Claude Code's claude.ai Slack connector |
| `oru/skills/sync` | Re-syncs the saved Figma files and Drive folders, only what changed |
| `oru/agents/oru-indexer.md` | Subagent that reads Figma or Drive and sends what changed to Oru |
| `oru/scripts/drive.mjs` | Dependency-free Google Drive reader: `login`, `status`, `list`, `read`, `logout` |
| `oru/scripts/microsoft.mjs` | Dependency-free Microsoft Graph reader: `login-start`, `login-finish`, `status`, `sources`, `list`, `read`, `logout` |
| `oru/hooks/hooks.json` | Claude Code: states the folder at session start, adds Oru context to each prompt, saves each reply's new messages to Oru |
| `oru/scripts/oru.mjs`, `oru/scripts/capture.mjs` | Oru sign-in for this machine, and the hook that sends conversations in the background |
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

## Conversations

Once the plugin is signed in to Oru (`setup` does it, or the `conversations` skill), each Claude
Code reply's new messages are sent, in the background, to your **private** chat for the folder's
project in orubrain.com. Oru learns from what you say there like it does from its own chat.

- Saved: your messages and the agent's replies, with one line per action it took.
- Never saved: tool output, file contents, and secrets (stripped on your machine and again by Oru).
- Off switch: the plugin's **Save conversations** setting; "don't save this" pauses one session.
- Sign-in uses Oru's own OAuth (token in `~/.oru/oru.json`); an Oru access key works too.

## Microsoft 365

`scripts/microsoft.mjs` reads OneDrive, SharePoint sites and the files of your Teams through
Microsoft Graph, **read-only** (`Files.Read.All`, `Sites.Read.All`, plus `Team.ReadBasic.All` to list
your Teams). It signs in with a device code: it shows a link and a code, you enter the code at
Microsoft, and the token is stored in `~/.oru/microsoft.json` (readable only by you). Teams messages
are not read.

It needs a Microsoft Entra app (until Orubrain's own is published):

1. In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** →
   **New registration**. Any name (e.g. "Oru"); supported accounts: **any organizational directory
   and personal Microsoft accounts**; no redirect URI.
2. **Authentication** → **Allow public client flows** → **Yes**.
3. **API permissions** → Microsoft Graph → **Delegated**: `Files.Read.All`, `Sites.Read.All`,
   `Team.ReadBasic.All`, `User.Read`, `offline_access`.
4. Save `{"client_id": "<Application (client) ID>", "tenant": "common"}` as
   `~/.oru/microsoft-oauth-client.json`.

Files are read the same way as from Drive: Word and PowerPoint as text, Excel as CSV per sheet,
PDFs (and older Office files, which Graph converts to PDF) handed to your agent.

## Slack

Slack is read through Claude Code's **claude.ai Slack connector** (Slack's official MCP server), so
there is nothing to install: sign in from `/mcp` → **claude.ai Slack**. Oru only reads the public
channels you pick, one document per channel per month, and never direct messages. Slack is not
available in Codex yet.

## Develop

```bash
claude plugin validate ./ && claude plugin validate ./oru
node --test oru/scripts/*.test.mjs
claude plugin marketplace add ./   # install from your local checkout
```

To test against a local Oru, set the plugin's **Oru address** option to `http://localhost:3000`
(`/config`, or when Claude Code asks for the plugin's settings). The MCP server and the hooks both
follow it. Remove any separate `orubrain` server you added by hand, so the agent sees only one.
