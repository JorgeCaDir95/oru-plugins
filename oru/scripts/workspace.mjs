// Shared by the plugin's hooks: which Oru deployment and key to use, and which
// folder the agent is working in. The folder is sent as its git remote URL
// (Oru normalizes it to owner/repo, so every teammate's clone matches) or, with
// no remote, its folder name.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export function oruConfig() {
  return {
    // ORUBRAIN_MCP_TOKEN is the name the Orubrain Agents page tells users to set;
    // ORU_API_TOKEN was the plugin's earlier name and is still honoured.
    token: process.env.ORUBRAIN_MCP_TOKEN || process.env.ORU_API_TOKEN || '',
    baseUrl: (process.env.ORU_APP_URL || 'https://orubrain.com').replace(/\/+$/, ''),
  };
}

export function workspaceFor(cwd) {
  const dir = cwd || process.cwd();
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 500,
    }).trim();
    if (remote) return remote;
  } catch {
    // Not a git repo, or no origin: fall back to the folder name.
  }
  return basename(dir);
}

/** The JSON the client pipes into a hook, or {} when there is none. */
export function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/** Hand extra context to the model — the JSON shape both Claude Code and Codex accept. */
export function emitContext(hookEventName, additionalContext) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }));
}
