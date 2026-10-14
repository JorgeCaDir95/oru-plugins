import test from 'node:test';
import assert from 'node:assert/strict';
import { pickGoogleClient, pickMicrosoftClient } from './oauth-clients-lib.mjs';

const bundled = {
  google: { client_id: 'oru-google', client_secret: 'oru-secret' },
  microsoft: { client_id: 'oru-ms', tenant: 'common' },
};
const empty = { google: { client_id: '', client_secret: '' }, microsoft: { client_id: '', tenant: 'common' } };

test('without a file of their own, people sign in with Orubrain\'s client', () => {
  assert.deepEqual(pickGoogleClient(null, bundled), { clientId: 'oru-google', clientSecret: 'oru-secret', own: false });
  assert.deepEqual(pickMicrosoftClient(null, bundled), { clientId: 'oru-ms', tenant: 'common', own: false });
});

test('a client of their own wins, in Google\'s downloaded shape too', () => {
  assert.deepEqual(pickGoogleClient({ installed: { client_id: 'mine', client_secret: 's' } }, bundled), { clientId: 'mine', clientSecret: 's', own: true });
  assert.deepEqual(pickMicrosoftClient({ client_id: 'mine', tenant: 'acme.onmicrosoft.com' }, bundled), { clientId: 'mine', tenant: 'acme.onmicrosoft.com', own: true });
});

test('no client anywhere is null, so the script can say what to do', () => {
  assert.equal(pickGoogleClient(null, empty), null);
  assert.equal(pickMicrosoftClient({}, empty), null);
  assert.equal(pickGoogleClient(null, null), null);
});
