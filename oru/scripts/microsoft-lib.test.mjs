import assert from 'node:assert/strict';
import test from 'node:test';
import { isMicrosoftUrl, itemKey, parseItemKey, shareId, toFile } from './microsoft-lib.mjs';

test('shareId is Graph\'s u!-prefixed base64url of the link', () => {
  // The example from Microsoft Graph's "shares" documentation.
  assert.equal(
    shareId('https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1'),
    'u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx',
  );
});

test('item keys round-trip and reject anything else', () => {
  assert.equal(itemKey('b!drive', '01ITEM'), 'b!drive:01ITEM');
  assert.deepEqual(parseItemKey('b!drive:01ITEM'), { driveId: 'b!drive', itemId: '01ITEM' });
  assert.equal(parseItemKey('https://contoso.sharepoint.com/x'), null);
  assert.equal(parseItemKey('nope'), null);
});

test('only OneDrive, SharePoint and Teams links over https are Microsoft links', () => {
  assert.equal(isMicrosoftUrl('https://contoso.sharepoint.com/sites/Brand'), true);
  assert.equal(isMicrosoftUrl('https://contoso-my.sharepoint.com/personal/ana'), true);
  assert.equal(isMicrosoftUrl('https://1drv.ms/f/s!Ab'), true);
  assert.equal(isMicrosoftUrl('http://contoso.sharepoint.com/x'), false);
  assert.equal(isMicrosoftUrl('https://sharepoint.com.evil.example/x'), false);
});

test('toFile gives a driveItem the same shape as a Drive file', () => {
  assert.deepEqual(toFile({
    id: '01ITEM', name: 'Brand.docx', size: 2048, webUrl: 'https://contoso.sharepoint.com/Brand.docx',
    lastModifiedDateTime: '2026-10-02T09:00:00Z', parentReference: { driveId: 'b!drive' },
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  }, 'Marketing/Brand.docx'), {
    id: 'b!drive:01ITEM', name: 'Brand.docx', path: 'Marketing/Brand.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    modifiedTime: '2026-10-02T09:00:00Z', url: 'https://contoso.sharepoint.com/Brand.docx', size: 2048,
  });
});
