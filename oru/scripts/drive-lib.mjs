// Pure helpers for the Google Drive script: links, text from Office files,
// CSV, and which files changed since Oru last saw them. No network, no
// dependencies, so they can be unit-tested (drive-lib.test.mjs).
import { inflateRawSync } from 'node:zlib';

export const GOOGLE_DOC = 'application/vnd.google-apps.document';
export const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
export const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
export const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PDF = 'application/pdf';

/** A Drive folder or file id from a link or a bare id, or null. */
export function driveId(raw) {
  const value = String(raw ?? '').trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'drive.google.com') {
    const match = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/)
      || url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/);
    if (match) return match[1];
    const open = url.pathname === '/open' ? url.searchParams.get('id') : null;
    return open && /^[A-Za-z0-9_-]{10,}$/.test(open) ? open : null;
  }
  if (host === 'docs.google.com') {
    const match = url.pathname.match(/^\/(?:document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,})/);
    return match ? match[1] : null;
  }
  return null;
}

/** A Drive search query: files whose name or content contains `text`, not trashed, not folders. */
export function searchQuery(text) {
  const escaped = String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `fullText contains '${escaped}' and trashed = false and mimeType != '${GOOGLE_FOLDER}'`;
}

/**
 * Files to read: those Oru does not hold yet, holds with a different
 * modifiedTime, or failed to index. `known` is get_sync_state's `documents`
 * (or its whole structuredContent).
 */
export function changedFiles(files, known) {
  const docs = Array.isArray(known) ? known
    : Array.isArray(known?.documents) ? known.documents
      : Array.isArray(known?.connectors) ? known.connectors.flatMap((c) => c.documents ?? [])
        : [];
  const held = new Map(docs.map((d) => [String(d.externalId), d]));
  return files.filter((file) => {
    const doc = held.get(file.id);
    if (!doc || doc.status === 'skipped') return true;
    if (!doc.modifiedAt || !file.modifiedTime) return true;
    return new Date(doc.modifiedAt).getTime() !== new Date(file.modifiedTime).getTime();
  });
}

export function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const text = cell == null ? '' : String(cell);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}

// ── Office files (.docx, .xlsx, .pptx are ZIP archives of XML) ──────────────

/** Every entry of a ZIP archive as name → Buffer. Stored and deflated entries only. */
export function unzip(buffer) {
  const buf = Buffer.from(buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buf.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, inflateRawSync(data));
  }
  return entries;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function textRuns(xml, tag) {
  // Paragraph ends become newlines; only the text runs (<w:t>, <a:t>) are kept.
  const withBreaks = xml
    .replace(/<\/(?:w|a):p>/g, '\n')
    .replace(/<(?:w|a):(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<w:tab\b[^>]*\/>/g, '\t');
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>|\\n|\\t`, 'g');
  for (const match of withBreaks.matchAll(re)) out.push(match[1] !== undefined ? decode(match[1]) : match[0]);
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const numbered = (prefix) => (a, b) => Number(a.slice(prefix.length).match(/\d+/)?.[0] ?? 0)
  - Number(b.slice(prefix.length).match(/\d+/)?.[0] ?? 0);

export function docxText(buffer) {
  const xml = unzip(buffer).get('word/document.xml');
  if (!xml) throw new Error('no word/document.xml in this file');
  return textRuns(xml.toString('utf8'), 'w:t');
}

export function pptxText(buffer) {
  const entries = unzip(buffer);
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(numbered('ppt/slides/slide'));
  return slides.map((name, i) => `## Slide ${i + 1}\n${textRuns(entries.get(name).toString('utf8'), 'a:t')}`).join('\n\n');
}

function columnIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export function xlsxText(buffer) {
  const entries = unzip(buffer);
  const xml = (name) => entries.get(name)?.toString('utf8') ?? '';
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
  const rels = new Map([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    m[0].match(/\bId="([^"]+)"/)?.[1], m[0].match(/\bTarget="([^"]+)"/)?.[1],
  ]));
  const sheets = [...xml('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(m[0].match(/\bname="([^"]*)"/)?.[1] ?? 'Sheet'),
    target: rels.get(m[0].match(/\br:id="([^"]+)"/)?.[1]),
  }));
  return sheets.map(({ name, target }) => {
    const path = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` : '';
    const rows = [...xml(path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? '';
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = '';
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join('');
        else if (raw !== undefined) value = decode(raw);
        cells[ref ? columnIndex(ref) : cells.length] = value;
      }
      return Array.from(cells, (v) => v ?? '');
    });
    return `## Sheet: ${name}\n${toCsv(rows)}`;
  }).join('\n\n');
}
