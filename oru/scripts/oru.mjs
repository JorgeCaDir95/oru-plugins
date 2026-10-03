#!/usr/bin/env node
// Signs this machine in to Oru, so the plugin's hooks can save this agent's
// conversations (D-135) without an access key. Standard OAuth for MCP:
// discover Oru's authorization server, register as a public client, sign in
// in the browser with PKCE. The token stays in ~/.oru/oru.json.
//
//   oru.mjs login [--url https://orubrain.com]   sign in (opens the browser)
//   oru.mjs status                               signed in? saving conversations?
//   oru.mjs logout                               forget the token
//   oru.mjs pause <sessionId> / resume <sessionId>  stop or restart saving one session
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { ORU_DIR, SESSIONS_DIR, defaultOruUrl, readJson, savingConversations, writePrivate } from './oru-auth.mjs';

const TOKEN_FILE = join(ORU_DIR, 'oru.json');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

async function getJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* the URL is printed too */ }
}

async function login(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const meta = await getJson(`${base}/.well-known/oauth-protected-resource/api/mcp`);
  const issuer = meta.body?.authorization_servers?.[0];
  const resource = meta.body?.resource ?? `${base}/api/mcp`;
  if (!meta.ok || !issuer) {
    fail(`${base} does not offer sign-in yet. Set the plugin's "Oru access key" option instead (orubrain.com → Agents → Advanced).`);
  }
  const as = await getJson(`${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`);
  const { authorization_endpoint: authorizeUrl, token_endpoint: tokenUrl, registration_endpoint: registerUrl } = as.body ?? {};
  if (!authorizeUrl || !tokenUrl || !registerUrl) fail('Oru\'s sign-in server did not describe itself; try again later.');

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const result = await new Promise((resolve, reject) => {
    let port = 0;
    let clientId = '';
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
        .end(ok ? '<p>This machine is signed in to Oru. You can close this tab.</p>' : '<p>Sign-in failed. Close this tab and try again.</p>');
      server.close();
      if (ok) resolve({ code: url.searchParams.get('code'), redirectUri: `http://127.0.0.1:${port}/callback`, clientId });
      else reject(new Error(url.searchParams.get('error') ?? 'the sign-in did not complete'));
    });
    server.listen(0, '127.0.0.1', async () => {
      port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const registered = await getJson(registerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Oru plugin', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'], token_endpoint_auth_method: 'none',
        }),
      }).catch((error) => ({ ok: false, body: { error: error.message } }));
      if (!registered.ok || !registered.body?.client_id) {
        server.close();
        reject(new Error(`Oru's sign-in server refused to register this machine: ${registered.body?.error_description ?? registered.body?.error ?? 'unknown error'}`));
        return;
      }
      clientId = registered.body.client_id;
      const auth = new URL(authorizeUrl);
      auth.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid profile email offline_access',
        code_challenge: challenge, code_challenge_method: 'S256', state, resource,
      }).toString();
      process.stderr.write(`Opening Oru sign-in. If the browser does not open, visit:\n${auth}\n`);
      openBrowser(auth.toString());
    });
    setTimeout(() => { server.close(); reject(new Error('timed out waiting for the Oru sign-in (5 minutes)')); }, 300_000).unref();
  });

  const token = await getJson(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: result.code, redirect_uri: result.redirectUri,
      client_id: result.clientId, code_verifier: verifier, resource,
    }),
  });
  if (!token.ok || !token.body?.access_token) fail(`Oru's sign-in server refused the sign-in: ${token.body?.error_description ?? token.body?.error ?? token.status}`);
  const claims = JSON.parse(Buffer.from(token.body.access_token.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}');
  writePrivate(TOKEN_FILE, {
    base, resource, tokenUrl, clientId: result.clientId,
    access_token: token.body.access_token, refresh_token: token.body.refresh_token ?? null,
    expires_at: Date.now() + (token.body.expires_in ?? 300) * 1000, email: claims.email ?? null,
  });
  print({ signedIn: true, email: claims.email ?? null, oru: base });
}

function status() {
  const token = readJson(TOKEN_FILE);
  print({
    signedIn: Boolean(token?.refresh_token || token?.access_token),
    email: token?.email ?? null,
    oru: token?.base ?? defaultOruUrl(),
    savingConversations: savingConversations(),
  });
}

function logout() {
  rmSync(TOKEN_FILE, { force: true });
  print({ signedIn: false });
}

function setPaused(sessionId, paused) {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(String(sessionId ?? ''))) fail('Pass the session id (shown in the conversation hooks as session_id).');
  const marker = join(SESSIONS_DIR, `${sessionId}.paused`);
  if (paused) writePrivate(marker, { pausedAt: new Date().toISOString() });
  else if (existsSync(marker)) rmSync(marker);
  print({ sessionId, saving: !paused });
}

const [command, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
try {
  if (command === 'login') await login(flag('--url') || defaultOruUrl());
  else if (command === 'status') status();
  else if (command === 'logout') logout();
  else if (command === 'pause') setPaused(args[0], true);
  else if (command === 'resume') setPaused(args[0], false);
  else fail('Usage: oru.mjs login [--url <oru>] | status | logout | pause <sessionId> | resume <sessionId>');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
