// Shared by the Oru sign-in script and the conversation hooks: where Oru is,
// the saved sign-in (renewed when it expires), and whether saving
// conversations is on. Hooks receive the plugin's options as
// CLAUDE_PLUGIN_OPTION_<KEY>; scripts the agent runs do not, so the Oru
// address used at sign-in is saved with the token.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ORU_DIR = join(homedir(), '.oru');
export const SESSIONS_DIR = join(ORU_DIR, 'sessions');
const TOKEN_FILE = join(ORU_DIR, 'oru.json');

export const readJson = (path) => {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
};

export function writePrivate(path, value) {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function defaultOruUrl() {
  return (process.env.CLAUDE_PLUGIN_OPTION_ORU_URL || process.env.ORU_APP_URL
    || readJson(TOKEN_FILE)?.base || 'https://orubrain.com').replace(/\/+$/, '');
}

/** On unless the plugin's "Save conversations" option is turned off. */
export function savingConversations() {
  return String(process.env.CLAUDE_PLUGIN_OPTION_SAVE_CONVERSATIONS ?? 'true').toLowerCase() !== 'false';
}

/**
 * A bearer for Oru: the plugin's own sign-in (renewed if it expired), else the
 * plugin's access key option or ORUBRAIN_MCP_TOKEN. Null when there is neither.
 */
export async function oruBearer() {
  const saved = readJson(TOKEN_FILE);
  if (saved?.access_token) {
    if (saved.expires_at > Date.now() + 30_000) return { token: saved.access_token, base: saved.base };
    if (saved.refresh_token && saved.tokenUrl) {
      try {
        const res = await fetch(saved.tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: saved.clientId, resource: saved.resource,
          }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.access_token) {
          writePrivate(TOKEN_FILE, {
            ...saved, access_token: body.access_token, refresh_token: body.refresh_token ?? saved.refresh_token,
            expires_at: Date.now() + (body.expires_in ?? 300) * 1000,
          });
          return { token: body.access_token, base: saved.base };
        }
      } catch {
        // Fall through to an access key, if any.
      }
    }
  }
  const key = process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN || process.env.ORUBRAIN_MCP_TOKEN || process.env.ORU_API_TOKEN;
  return key ? { token: key, base: defaultOruUrl() } : null;
}
