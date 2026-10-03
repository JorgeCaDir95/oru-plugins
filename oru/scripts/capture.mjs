#!/usr/bin/env node
// Stop / SessionEnd hook: saves this session's new messages to Oru (D-135).
// The hook itself only hands the work to a detached process and exits, so
// the session never waits on Oru. That process reads the transcript from
// where the last send stopped, keeps the person's and the agent's messages
// (one line per action, no tool output, secrets stripped) and posts them to
// <oru>/api/agent-sessions. Fails silently: Oru being down never breaks a
// session, and an unsent part is retried on the next reply.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptTurns } from './capture-lib.mjs';
import { SESSIONS_DIR, oruBearer, readJson, savingConversations, writePrivate } from './oru-auth.mjs';
import { readHookInput, workspaceFor } from './workspace.mjs';

const BATCH = 50;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,120}$/;

async function flush(sessionId, transcriptPath, cwd, event) {
  const lock = join(SESSIONS_DIR, `${sessionId}.lock`);
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 60_000) return;
  writePrivate(lock, { at: Date.now() });
  try {
    const bearer = await oruBearer();
    if (!bearer) return;
    const stateFile = join(SESSIONS_DIR, `${sessionId}.json`);
    const state = readJson(stateFile) ?? { sent: 0 };
    const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    const fresh = lines.slice(state.sent);
    const turns = transcriptTurns(fresh);
    const ended = event === 'SessionEnd';
    if (!turns.length && !ended) {
      writePrivate(stateFile, { ...state, sent: lines.length });
      return;
    }
    const workspace = workspaceFor(cwd);
    const chunks = turns.length ? Array.from({ length: Math.ceil(turns.length / BATCH) }, (_, i) => turns.slice(i * BATCH, (i + 1) * BATCH)) : [[]];
    for (const [i, chunk] of chunks.entries()) {
      const res = await fetch(`${bearer.base}/api/agent-sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, client: 'Claude Code', workspace, turns: chunk, ended: ended && i === chunks.length - 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        writePrivate(stateFile, { ...state, lastError: `${res.status}: ${body.error ?? res.statusText}`, lastErrorAt: new Date().toISOString() });
        return;
      }
    }
    writePrivate(stateFile, { sent: lines.length, lastSentAt: new Date().toISOString() });
  } catch (error) {
    const stateFile = join(SESSIONS_DIR, `${sessionId}.json`);
    writePrivate(stateFile, { ...(readJson(stateFile) ?? { sent: 0 }), lastError: String(error?.message ?? error), lastErrorAt: new Date().toISOString() });
  } finally {
    rmSync(lock, { force: true });
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'flush') {
  await flush(...args).catch(() => {});
} else {
  // Hook entry point: decide quickly, hand off, exit 0 whatever happens.
  try {
    const input = readHookInput();
    const sessionId = String(input.session_id ?? '');
    const transcript = String(input.transcript_path ?? '');
    const paused = existsSync(join(SESSIONS_DIR, `${sessionId}.paused`));
    if (savingConversations() && !paused && SESSION_ID.test(sessionId) && transcript && existsSync(transcript)) {
      spawn(process.execPath, [fileURLToPath(import.meta.url), 'flush', sessionId, transcript, String(input.cwd ?? process.cwd()), String(input.hook_event_name ?? '')], {
        detached: true, stdio: 'ignore', env: process.env,
      }).unref();
    }
  } catch {
    // Saving a conversation must never break the session.
  }
}
