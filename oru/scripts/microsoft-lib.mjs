// Pure helpers for the Microsoft 365 script: Graph sharing ids, item keys and
// the file shape the agent works with. No network (microsoft-lib.test.mjs).

/** Microsoft Graph's sharing id for a OneDrive/SharePoint/Teams link: `u!` + base64url. */
export function shareId(url) {
  return `u!${Buffer.from(String(url).trim(), 'utf8').toString('base64url')}`;
}

/** One file, everywhere: `<driveId>:<itemId>` (item ids are unique per drive). */
export function itemKey(driveId, itemId) {
  return `${driveId}:${itemId}`;
}

export function parseItemKey(value) {
  // No slashes: a link like https://… must never pass for a key.
  const match = String(value ?? '').match(/^([^:/\s]+):([^:/\s]+)$/);
  return match ? { driveId: match[1], itemId: match[2] } : null;
}

const MICROSOFT_HOSTS = [/\.sharepoint\.com$/, /^onedrive\.live\.com$/, /^1drv\.ms$/, /^(www\.)?onedrive\.com$/];

export function isMicrosoftUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' && MICROSOFT_HOSTS.some((host) => host.test(url.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

/** A Graph driveItem as the agent sees it, with the same fields as the Drive script. */
export function toFile(item, path) {
  const driveId = item.parentReference?.driveId;
  return {
    id: itemKey(driveId, item.id),
    name: item.name,
    path,
    mimeType: item.file?.mimeType ?? null,
    modifiedTime: item.lastModifiedDateTime ?? null,
    url: item.webUrl ?? null,
    size: typeof item.size === 'number' ? item.size : null,
  };
}

// Office formats Graph can convert to PDF for the agent to read
// (GET /content?format=pdf); the modern ones are read as text directly.
export const CONVERTIBLE_TO_PDF = new Set([
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/rtf', 'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation',
]);
