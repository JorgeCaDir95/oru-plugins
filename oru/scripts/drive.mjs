#!/usr/bin/env node
// Google Drive, read-only, from the user's machine. The agent (Claude Code,
// Codex, …) runs this to read the Drive folders the user chose and sends the
// text to Oru with ingest_batch. The OAuth token stays in ~/.oru on this
// machine; Oru never receives it.
//
//   drive.mjs login                     sign in with Google (opens the browser)
//   drive.mjs status                    {"connected":true,"email":"…"}
//   drive.mjs logout                    revoke the token and forget it
//   drive.mjs list <folder> [--known f] files under a folder, recursively; with
//                                       --known (get_sync_state documents as
//                                       JSON), only new or changed ones
//   drive.mjs read <file>               one file as text, ready for ingest_batch
//   drive.mjs search <text> [--limit n] files anywhere in the user's Drive whose
//                                       name or content matches, no link needed
//   drive.mjs recent [--limit n]        the most recently modified files
//
// <folder>/<file> is a Drive link or id. Output is JSON on stdout; errors go
// to stderr with a non-zero exit code.
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickGoogleClient } from './oauth-clients-lib.mjs';
import {
  DOCX, GOOGLE_DOC, GOOGLE_FOLDER, GOOGLE_SHEET, GOOGLE_SLIDES, PDF, PPTX, XLSX,
  changedFiles, docxText, driveId, pptxText, searchQuery, toCsv, xlsxText,
} from './drive-lib.mjs';

const ORU_DIR = join(homedir(), '.oru');
const TOKEN_FILE = join(ORU_DIR, 'google-drive.json');
// The "Desktop app" OAuth client JSON downloaded from Google Cloud. A desktop
// client's secret is not confidential (Google's own guidance for installed
// apps); what protects the user is the consent screen and PKCE.
const CLIENT_FILE = join(ORU_DIR, 'google-oauth-client.json');
// Orubrain's own clients ship with the plugin; a file in ~/.oru overrides them.
const BUNDLED_CLIENTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'oauth-clients.json');
const bundledClients = () => (existsSync(BUNDLED_CLIENTS) ? JSON.parse(readFileSync(BUNDLED_CLIENTS, 'utf8')) : null);
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'openid', 'email'];
const DRIVE = 'https://www.googleapis.com/drive/v3';
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
// Oru's ingest accepts up to 500 KB of text per document.
const MAX_CONTENT_CHARS = 450_000;
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,size,parents';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function oauthClient() {
  const own = existsSync(CLIENT_FILE) ? JSON.parse(readFileSync(CLIENT_FILE, 'utf8')) : null;
  const client = pickGoogleClient(own, bundledClients());
  if (!client) {
    fail(`This version of the oru plugin has no Google sign-in client yet. Update the plugin, or (for a company's own app) create a Google Cloud OAuth client of type "Desktop app" with the Drive API enabled and save its JSON as ${CLIENT_FILE}.`);
  }
  return client;
}

function saveToken(token) {
  mkdirSync(ORU_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);
}

const loadToken = () => (existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) : null);

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google refused the token request: ${body.error_description ?? body.error ?? res.status}`);
  return body;
}

async function accessToken() {
  const token = loadToken();
  if (!token?.refresh_token) fail('Not signed in to Google Drive. Run this script with `login` first.');
  if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;
  const { clientId, clientSecret } = oauthClient();
  try {
    const fresh = await tokenRequest({
      client_id: clientId, client_secret: clientSecret, refresh_token: token.refresh_token, grant_type: 'refresh_token',
    });
    saveToken({ ...token, access_token: fresh.access_token, expires_at: Date.now() + fresh.expires_in * 1000 });
    return fresh.access_token;
  } catch (error) {
    fail(`${error.message}. Run this script with \`login\` again.`);
  }
}

async function google(url, { raw = false } = {}) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google returned ${res.status} for ${new URL(url).pathname}: ${body.error?.message ?? res.statusText}`);
  }
  return raw ? res : res.json();
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // The URL is printed too; the user can open it by hand.
  }
}

async function login() {
  const { clientId, clientSecret } = oauthClient();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
        .end(ok ? '<p>Google Drive is connected to Oru. You can close this tab.</p>' : '<p>Sign-in failed. Close this tab and try again.</p>');
      server.close();
      if (ok) resolve({ code: url.searchParams.get('code'), redirectUri: `http://127.0.0.1:${port}/callback` });
      else reject(new Error(url.searchParams.get('error') ?? 'the sign-in did not complete'));
    });
    let port = 0;
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();
      process.stderr.write(`Opening Google sign-in (read-only). If the browser does not open, visit:\n${auth}\n`);
      openBrowser(auth.toString());
    });
    setTimeout(() => { server.close(); reject(new Error('timed out waiting for the Google sign-in (5 minutes)')); }, 300_000).unref();
  });

  const token = await tokenRequest({
    client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  if (!token.refresh_token) fail('Google did not return a refresh token. Remove Oru from https://myaccount.google.com/permissions and sign in again.');
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  saveToken({
    refresh_token: token.refresh_token,
    access_token: token.access_token,
    expires_at: Date.now() + token.expires_in * 1000,
    email: info.email ?? null,
    scope: token.scope,
  });
  print({ connected: true, email: info.email ?? null });
}

async function status() {
  const token = loadToken();
  if (!token?.refresh_token) return print({ connected: false, email: null });
  const res = await fetch(`${DRIVE}/about?fields=user(emailAddress)`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  const body = await res.json().catch(() => ({}));
  print(res.ok ? { connected: true, email: body.user?.emailAddress ?? token.email ?? null } : { connected: false, email: token.email ?? null });
}

async function logout() {
  const token = loadToken();
  if (token?.refresh_token) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token.refresh_token }),
    }).catch(() => {});
  }
  rmSync(TOKEN_FILE, { force: true });
  print({ connected: false });
}

async function listFolder(rootId) {
  const root = await google(`${DRIVE}/files/${rootId}?fields=${FILE_FIELDS}&supportsAllDrives=true`);
  if (root.mimeType !== GOOGLE_FOLDER) return [{ ...root, path: root.name }];
  const files = [];
  const queue = [{ id: root.id, path: root.name }];
  while (queue.length) {
    const folder = queue.shift();
    let pageToken;
    do {
      const url = new URL(`${DRIVE}/files`);
      url.search = new URLSearchParams({
        q: `'${folder.id}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const page = await google(url.toString());
      for (const file of page.files ?? []) {
        const path = `${folder.path}/${file.name}`;
        if (file.mimeType === GOOGLE_FOLDER) queue.push({ id: file.id, path });
        else files.push({ ...file, path });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return files;
}

// Everywhere the user can read: My Drive, files shared with them and shared drives.
async function findFiles({ q, orderBy, limit }) {
  const url = new URL(`${DRIVE}/files`);
  url.search = new URLSearchParams({
    q,
    fields: `files(${FILE_FIELDS})`,
    pageSize: String(Math.min(Math.max(Number(limit) || 20, 1), 100)),
    corpora: 'allDrives',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    ...(orderBy ? { orderBy } : {}),
  }).toString();
  const page = await google(url.toString());
  return (page.files ?? []).map((f) => ({
    id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, url: f.webViewLink,
    size: f.size ? Number(f.size) : null,
  }));
}

async function search(text, limit) {
  if (!text?.trim()) fail('Pass the words to search for.');
  print({ query: text, files: await findFiles({ q: searchQuery(text), limit }) });
}

async function recent(limit) {
  print({ files: await findFiles({
    q: `trashed = false and mimeType != '${GOOGLE_FOLDER}'`, orderBy: 'modifiedTime desc', limit,
  }) });
}

async function list(target, knownFile) {
  const id = driveId(target);
  if (!id) fail('Pass a Google Drive folder or file link (or id).');
  const all = await listFolder(id);
  const files = knownFile ? changedFiles(all, JSON.parse(readFileSync(knownFile, 'utf8'))) : all;
  print({
    sourceId: id,
    total: all.length,
    toRead: files.length,
    files: files.map((f) => ({
      id: f.id, name: f.name, path: f.path, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
      url: f.webViewLink, size: f.size ? Number(f.size) : null,
    })),
  });
}

async function download(id) {
  const res = await google(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { raw: true });
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('file is larger than 25 MB');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_DOWNLOAD_BYTES) throw new Error('file is larger than 25 MB');
  return body;
}

async function exportAs(id, mimeType) {
  const res = await google(`${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(mimeType)}`, { raw: true });
  return res.text();
}

async function sheetText(id) {
  const meta = await google(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
  const titles = (meta.sheets ?? []).map((s) => s.properties.title);
  if (!titles.length) return '';
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet`);
  for (const title of titles) url.searchParams.append('ranges', `'${title.replace(/'/g, "''")}'`);
  const values = await google(url.toString());
  return (values.valueRanges ?? []).map((range, i) => `## Sheet: ${titles[i]}\n${toCsv(range.values ?? [])}`).join('\n\n');
}

async function read(target) {
  const id = driveId(target);
  if (!id) fail('Pass a Google Drive file link (or id).');
  const file = await google(`${DRIVE}/files/${id}?fields=${FILE_FIELDS}&supportsAllDrives=true`);
  const base = { id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, url: file.webViewLink };

  let content = null;
  let format = null;
  const type = file.mimeType;
  if (type === GOOGLE_DOC) {
    content = await exportAs(id, 'text/markdown').catch(() => exportAs(id, 'text/plain'));
    format = 'markdown';
  } else if (type === GOOGLE_SHEET) {
    content = await sheetText(id);
    format = 'csv';
  } else if (type === GOOGLE_SLIDES) {
    content = await exportAs(id, 'text/plain');
    format = 'text';
  } else if (type === DOCX) {
    content = docxText(await download(id));
    format = 'text';
  } else if (type === XLSX) {
    content = xlsxText(await download(id));
    format = 'csv';
  } else if (type === PPTX) {
    content = pptxText(await download(id));
    format = 'text';
  } else if (type.startsWith('text/') || type === 'application/json') {
    content = (await download(id)).toString('utf8');
    format = 'text';
  } else if (type === PDF) {
    // The agent reads PDFs itself (layout, tables, scans); hand it the file.
    const bytes = await download(id);
    const path = join(tmpdir(), `oru-drive-${file.id}.pdf`);
    writeFileSync(path, bytes, { mode: 0o600 });
    return print({ ...base, format: 'pdf', file: path, content: null,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      note: 'Read this PDF with your own file reader, send its text as content with this contentHash, then delete the file.' });
  } else {
    return print({ ...base, format: null, content: null, skipped: `no text to read from ${type}` });
  }

  const truncated = content.length > MAX_CONTENT_CHARS;
  if (truncated) content = content.slice(0, MAX_CONTENT_CHARS);
  print({
    ...base, format, truncated,
    contentHash: createHash('sha256').update(content).digest('hex'),
    content,
  });
}

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

try {
  if (command === 'login') await login();
  else if (command === 'status') await status();
  else if (command === 'logout') await logout();
  else if (command === 'list') await list(positional[0], flag('--known'));
  else if (command === 'read') await read(positional[0]);
  else if (command === 'search') await search(positional.join(' '), flag('--limit'));
  else if (command === 'recent') await recent(flag('--limit'));
  else fail('Usage: drive.mjs login | status | logout | search <text> [--limit n] | recent [--limit n] | list <folder> [--known file.json] | read <file>');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
