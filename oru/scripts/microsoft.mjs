#!/usr/bin/env node
// Microsoft 365, read-only, from the user's machine: OneDrive, SharePoint and
// the files of the user's Teams, through Microsoft Graph. The agent (Claude
// Code, Codex, …) runs this to read the folders the user chose and sends the
// text to Oru with ingest_batch. The token stays in ~/.oru on this machine;
// Oru never receives it.
//
//   microsoft.mjs login-start             prints a link and a code for the user
//   microsoft.mjs login-finish            waits until the user entered the code
//   microsoft.mjs status                  {"connected":true,"email":"…"}
//   microsoft.mjs logout                  forgets the token on this machine
//   microsoft.mjs sources                 OneDrive, the user's Teams and followed SharePoint sites
//   microsoft.mjs list <source> [--known f]  files under a folder, recursively; with
//                                         --known (get_sync_state documents as JSON),
//                                         only new or changed ones
//   microsoft.mjs read <file>             one file as text, ready for ingest_batch
//
// <source> is a OneDrive/SharePoint/Teams link, `me` (your OneDrive) or
// `drive:<driveId>`. <file> is a link or a `<driveId>:<itemId>` from `list`.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOCX, PDF, PPTX, XLSX, changedFiles, docxText, pptxText, xlsxText } from './drive-lib.mjs';
import { CONVERTIBLE_TO_PDF, isMicrosoftUrl, parseItemKey, shareId, toFile } from './microsoft-lib.mjs';

const ORU_DIR = join(homedir(), '.oru');
const TOKEN_FILE = join(ORU_DIR, 'microsoft.json');
const PENDING_FILE = join(ORU_DIR, 'microsoft-pending.json');
// {"client_id": "…", "tenant": "common"} for a public Microsoft Entra app
// with "Allow public client flows" on. No secret: device-code sign-in.
const CLIENT_FILE = join(ORU_DIR, 'microsoft-oauth-client.json');
const SCOPES = 'offline_access openid profile User.Read Files.Read.All Sites.Read.All Team.ReadBasic.All';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ITEM_FIELDS = 'id,name,file,folder,lastModifiedDateTime,webUrl,size,parentReference';
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_CONTENT_CHARS = 450_000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function writePrivate(path, value) {
  mkdirSync(ORU_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

function oauthClient() {
  const client = readJson(CLIENT_FILE);
  if (!client?.client_id) {
    fail(`No Microsoft app yet. Register a public app in Microsoft Entra (see the plugin README) and save {"client_id": "…", "tenant": "common"} as ${CLIENT_FILE}.`);
  }
  return { clientId: client.client_id, tenant: client.tenant || 'common' };
}

async function tokenRequest(tenant, params) {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function accessToken() {
  const token = readJson(TOKEN_FILE);
  if (!token?.refresh_token) fail('Not signed in to Microsoft 365. Run this script with `login-start` first.');
  if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;
  const { clientId, tenant } = oauthClient();
  const { ok, body } = await tokenRequest(tenant, {
    client_id: clientId, grant_type: 'refresh_token', refresh_token: token.refresh_token, scope: SCOPES,
  });
  if (!ok) fail(`Microsoft refused to renew the sign-in (${body.error_description ?? body.error ?? 'unknown error'}). Run \`login-start\` again.`);
  writePrivate(TOKEN_FILE, {
    ...token,
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? token.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

async function graph(pathOrUrl, { raw = false } = {}) {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Microsoft Graph returned ${res.status} for ${new URL(url).pathname}: ${body.error?.message ?? res.statusText}`);
  }
  return raw ? res : res.json();
}

async function loginStart() {
  const { clientId, tenant } = oauthClient();
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`Microsoft refused to start the sign-in: ${body.error_description ?? body.error ?? res.status}`);
  writePrivate(PENDING_FILE, {
    device_code: body.device_code, interval: body.interval ?? 5, expires_at: Date.now() + body.expires_in * 1000,
  });
  print({
    verificationUri: body.verification_uri,
    userCode: body.user_code,
    expiresInMinutes: Math.round(body.expires_in / 60),
    tell: `Open ${body.verification_uri} and enter the code ${body.user_code}. Then run login-finish.`,
  });
}

async function loginFinish() {
  const pending = readJson(PENDING_FILE);
  if (!pending) fail('No sign-in in progress. Run `login-start` first.');
  const { clientId, tenant } = oauthClient();
  let interval = pending.interval * 1000;
  while (Date.now() < pending.expires_at) {
    const { ok, body } = await tokenRequest(tenant, {
      client_id: clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: pending.device_code,
    });
    if (ok) {
      rmSync(PENDING_FILE, { force: true });
      const me = await fetch(`${GRAPH}/me?$select=userPrincipalName,mail`, {
        headers: { authorization: `Bearer ${body.access_token}` },
      }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const email = me.mail ?? me.userPrincipalName ?? null;
      writePrivate(TOKEN_FILE, {
        refresh_token: body.refresh_token, access_token: body.access_token,
        expires_at: Date.now() + body.expires_in * 1000, email, scope: body.scope,
      });
      return print({ connected: true, email });
    }
    if (body.error === 'slow_down') interval += 5_000;
    else if (body.error !== 'authorization_pending') {
      rmSync(PENDING_FILE, { force: true });
      fail(body.error === 'authorization_declined' ? 'The sign-in was declined.'
        : body.error === 'expired_token' ? 'The code expired. Run `login-start` again.'
          : `Microsoft refused the sign-in: ${body.error_description ?? body.error}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  rmSync(PENDING_FILE, { force: true });
  fail('The code expired before it was entered. Run `login-start` again.');
}

async function status() {
  const token = readJson(TOKEN_FILE);
  if (!token?.refresh_token) return print({ connected: false, email: null });
  try {
    const me = await graph('/me?$select=userPrincipalName,mail');
    print({ connected: true, email: me.mail ?? me.userPrincipalName ?? token.email ?? null });
  } catch {
    print({ connected: false, email: token.email ?? null });
  }
}

function logout() {
  // A public client has no revoke endpoint; the user can also remove the app
  // at https://myapps.microsoft.com or https://account.live.com/consent/Manage.
  rmSync(TOKEN_FILE, { force: true });
  rmSync(PENDING_FILE, { force: true });
  print({ connected: false });
}

async function collectSources() {
  const found = [];
  const attempt = async (fn) => { try { await fn(); } catch { /* a section the account lacks */ } };
  await attempt(async () => {
    const drive = await graph('/me/drive?$select=id,webUrl,name');
    found.push({ kind: 'onedrive', name: 'OneDrive', source: `drive:${drive.id}`, url: drive.webUrl });
  });
  await attempt(async () => {
    const teams = await graph('/me/joinedTeams?$select=id,displayName');
    for (const team of teams.value ?? []) {
      await attempt(async () => {
        const drive = await graph(`/groups/${team.id}/drive?$select=id,webUrl`);
        found.push({ kind: 'team', name: team.displayName, source: `drive:${drive.id}`, url: drive.webUrl });
      });
    }
  });
  await attempt(async () => {
    const sites = await graph('/me/followedSites?$select=id,displayName,webUrl');
    for (const site of sites.value ?? []) {
      await attempt(async () => {
        const drive = await graph(`/sites/${site.id}/drive?$select=id,webUrl`);
        found.push({ kind: 'site', name: site.displayName, source: `drive:${drive.id}`, url: drive.webUrl });
      });
    }
  });
  return found;
}

async function sources() {
  print({ sources: await collectSources() });
}

const sameUrl = (a, b) => decodeURIComponent(String(a)).replace(/\/+$/, '').toLowerCase()
  === decodeURIComponent(String(b)).replace(/\/+$/, '').toLowerCase();

/** The driveItem a source or file argument points at. */
async function resolveItem(value) {
  const target = String(value ?? '').trim();
  if (target === 'me') return graph(`/me/drive/root?$select=${ITEM_FIELDS}`);
  const drive = target.match(/^drive:([^\s]+)$/);
  if (drive) return graph(`/drives/${drive[1]}/root?$select=${ITEM_FIELDS}`);
  const key = parseItemKey(target);
  if (key) return graph(`/drives/${key.driveId}/items/${key.itemId}?$select=${ITEM_FIELDS}`);
  if (isMicrosoftUrl(target)) {
    try {
      return await graph(`/shares/${shareId(target)}/driveItem?$select=${ITEM_FIELDS}`);
    } catch (error) {
      // A library or Team's root link may not resolve as a share; find it
      // among the user's own drives (what `sources` lists) instead.
      const match = (await collectSources()).find((s) => sameUrl(s.url, target));
      if (match) return graph(`/drives/${match.source.slice('drive:'.length)}/root?$select=${ITEM_FIELDS}`);
      throw error;
    }
  }
  fail('Pass a OneDrive, SharePoint or Teams link, `me`, `drive:<driveId>`, or a `<driveId>:<itemId>` from list.');
}

async function listFolder(root) {
  if (!root.folder) return [toFile(root, root.name)];
  // Graph puts the drive id on every item, the root included.
  const driveId = root.parentReference?.driveId;
  if (!driveId) fail('Microsoft Graph did not say which drive this folder is in.');
  const files = [];
  const queue = [{ id: root.id, path: root.name || 'root' }];
  while (queue.length) {
    const folder = queue.shift();
    let next = `/drives/${driveId}/items/${folder.id}/children?$select=${ITEM_FIELDS}&$top=200`;
    while (next) {
      const page = await graph(next);
      for (const item of page.value ?? []) {
        const path = `${folder.path}/${item.name}`;
        if (item.folder) queue.push({ id: item.id, path });
        else if (item.file) files.push(toFile(item, path));
      }
      next = page['@odata.nextLink'] ?? null;
    }
  }
  return files;
}

async function list(target, knownFile) {
  const root = await resolveItem(target);
  const all = await listFolder(root);
  const files = knownFile ? changedFiles(all, JSON.parse(readFileSync(knownFile, 'utf8'))) : all;
  print({ total: all.length, toRead: files.length, files });
}

async function download(driveId, itemId, format) {
  const res = await graph(`/drives/${driveId}/items/${itemId}/content${format ? `?format=${format}` : ''}`, { raw: true });
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('file is larger than 25 MB');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_DOWNLOAD_BYTES) throw new Error('file is larger than 25 MB');
  return body;
}

async function read(target) {
  const item = await resolveItem(target);
  if (item.folder) fail('That is a folder; use `list` to see its files.');
  const file = toFile(item, item.name);
  const { driveId } = parseItemKey(file.id) ?? {};
  const type = file.mimeType ?? '';
  const base = { id: file.id, name: file.name, mimeType: type, modifiedTime: file.modifiedTime, url: file.url };

  const handToAgent = async (format) => {
    const bytes = await download(driveId, item.id, format);
    const path = join(tmpdir(), `oru-microsoft-${item.id}.pdf`);
    writeFileSync(path, bytes, { mode: 0o600 });
    return print({ ...base, format: 'pdf', file: path, content: null,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      note: 'Read this PDF with your own file reader, send its text as content with this contentHash, then delete the file.' });
  };

  let content;
  let format;
  if (type === DOCX) { content = docxText(await download(driveId, item.id)); format = 'text'; }
  else if (type === XLSX) { content = xlsxText(await download(driveId, item.id)); format = 'csv'; }
  else if (type === PPTX) { content = pptxText(await download(driveId, item.id)); format = 'text'; }
  else if (type.startsWith('text/') || type === 'application/json') { content = (await download(driveId, item.id)).toString('utf8'); format = 'text'; }
  else if (type === PDF) return handToAgent();
  else if (CONVERTIBLE_TO_PDF.has(type)) return handToAgent('pdf');
  else return print({ ...base, format: null, content: null, skipped: `no text to read from ${type || 'this file'}` });

  const truncated = content.length > MAX_CONTENT_CHARS;
  if (truncated) content = content.slice(0, MAX_CONTENT_CHARS);
  print({ ...base, format, truncated, contentHash: createHash('sha256').update(content).digest('hex'), content });
}

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

try {
  if (command === 'login-start') await loginStart();
  else if (command === 'login-finish') await loginFinish();
  else if (command === 'status') await status();
  else if (command === 'logout') logout();
  else if (command === 'sources') await sources();
  else if (command === 'list') await list(positional[0], flag('--known'));
  else if (command === 'read') await read(positional[0]);
  else fail('Usage: microsoft.mjs login-start | login-finish | status | logout | sources | list <source> [--known file.json] | read <file>');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
