---
name: conversations
description: Saving this agent's conversations to Oru — signing this machine in to Oru, checking whether saving is on, and pausing it. Use when Oru's setup checks conversations, or the user says "don't save this", "stop saving", "resume saving", or asks whether Oru keeps what they talk about here.
user-invocable: true
---

# Conversations in Oru

While the oru plugin is signed in to Oru, every Claude Code session is saved to the user's **private** chat for the folder's project in orubrain.com (draft or unlinked folders go to their home chat). Oru learns from what the user says there, the same way it learns from its own chat. What is saved: the user's messages and the agent's replies, with one line per action ("→ Edit app/Login.tsx", "→ Bash npm test"). Never tool output or file contents, and secrets are stripped on this machine before anything is sent.

The script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/oru.mjs" <command>`. Every command prints JSON.

| Command | What it does |
|---|---|
| `status` | `signedIn`, the account, which Oru, and whether `savingConversations` is on |
| `link <code> --url ${user_config.oru_url}` | Signs this machine in with a one-time code from the `link_this_machine` tool: no second sign-in. The key stays in `~/.oru/` and is never printed |
| `login --url ${user_config.oru_url}` | Signs this machine in to Oru in the browser (only for an agent connected with an access key) |
| `logout` | Forgets the token on this machine |
| `pause <sessionId>` | Stops saving one session, from now on |
| `resume <sessionId>` | Saves it again from the next reply |

## Connect (from setup)

1. Run `status`. Signed in and saving → show "✅ Claude Code conversations — saved to Oru".
2. Not signed in → it is the same Oru account the agent is already signed in with, so do it without asking: call the `orubrain` server's `link_this_machine` (with your client name) and immediately run `link <code>`. Never show or repeat the code to the user. Only if `link_this_machine` says this agent uses an access key, ask permission and run `login` instead.
3. Saving off → it was turned off in the plugin's **Save conversations** setting; say so and leave it.

## "Don't save this"

When the user asks not to save the conversation (or part of it): find this session's id (the `session_id` Claude Code reports, also the name of the current transcript file), run `pause <sessionId>`, and confirm in one line that nothing more from this session goes to Oru. What was already sent stays in their private chat, where they can delete it. `resume <sessionId>` turns it back on.

## Rules

- Never claim a conversation was saved if `status` says otherwise.
- The conversation lives in the user's private chat; teammates do not see it. Only the memories Oru extracts follow the account's normal review.
