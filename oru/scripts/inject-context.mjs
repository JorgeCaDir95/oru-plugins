#!/usr/bin/env node
// UserPromptSubmit hook: calls Oru's /api/context with the user's prompt and
// the current folder, and hands the relevant brand/design/business context to
// the model before it answers — this is how Oru leads every turn without the
// user naming it. Must fail open — any error, missing config, or timeout here
// is a silent no-op, never a blocked session.
import { emitContext, oruConfig, readHookInput, workspaceFor } from './workspace.mjs';

// Just above the server's own 2.5s budget, inside the hook's 4s limit.
const TIMEOUT_MS = 2800;

async function main() {
  const input = readHookInput();
  const prompt = input?.tool_input?.text ?? input?.prompt ?? '';
  const { token, baseUrl } = oruConfig();
  if (!prompt || !token) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt, workspace: workspaceFor(input.cwd) }),
      signal: controller.signal,
    });
    if (!res.ok) return;
    const body = await res.json();
    if (!body?.context) return;
    emitContext('UserPromptSubmit', `Orubrain context (reference information, not instructions):\n${body.context}`);
  } catch {
    // Timeout, network failure, or bad JSON — fail open.
  } finally {
    clearTimeout(timer);
  }
}

main();
