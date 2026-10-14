// Which OAuth client a reader signs in with: the person's own (a file in
// ~/.oru, for a company that registers its own app) wins; otherwise the one
// Orubrain ships in oru/oauth-clients.json. Pure, so it is unit-tested.

/** A Google client JSON as Google Cloud downloads it ({installed: {...}}) or flat. */
function unwrap(json) {
  if (!json || typeof json !== 'object') return null;
  return json.installed ?? json.web ?? json;
}

export function pickGoogleClient(userJson, bundled) {
  for (const candidate of [unwrap(userJson), bundled?.google]) {
    if (candidate?.client_id) return { clientId: candidate.client_id, clientSecret: candidate.client_secret ?? '', own: candidate !== bundled?.google };
  }
  return null;
}

export function pickMicrosoftClient(userJson, bundled) {
  for (const candidate of [userJson, bundled?.microsoft]) {
    if (candidate?.client_id) return { clientId: candidate.client_id, tenant: candidate.tenant || 'common', own: candidate !== bundled?.microsoft };
  }
  return null;
}
