#!/usr/bin/env node
// SessionStart hook: tells the model, before the user's first message, that
// Oru leads this session and which `workspace` value identifies this folder,
// so its first Oru call can resolve the linked project. Local only —
// no network, so it can never slow down or break session start.
import { emitContext, readHookInput, workspaceFor } from './workspace.mjs';

const input = readHookInput();
const workspace = workspaceFor(input.cwd);

emitContext('SessionStart', [
  'Oru (the orubrain MCP server) is connected and leads this session.',
  `This folder's workspace value is: ${workspace}`,
  'Before anything else, call get_setup_status with that workspace. Start every task with get_context (same workspace) and finish by saving durable learnings with save_memory.',
].join('\n'));
