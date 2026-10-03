import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { changedFiles, docxText, driveId, pptxText, toCsv, unzip, xlsxText } from './drive-lib.mjs';

// A minimal ZIP writer (deflate, or stored when `stored` is set), enough to
// build real .docx/.xlsx/.pptx archives for the readers under test.
function zip(files, { stored = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = stored ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('driveId takes folder, file and editor links, or a bare id', () => {
  assert.equal(driveId(`https://drive.google.com/drive/u/0/folders/${ID}?usp=sharing`), ID);
  assert.equal(driveId(`https://docs.google.com/document/d/${ID}/edit`), ID);
  assert.equal(driveId(`https://drive.google.com/file/d/${ID}/view`), ID);
  assert.equal(driveId(ID), ID);
  assert.equal(driveId('https://www.figma.com/design/AbC123/Brand'), null);
  assert.equal(driveId(`http://drive.google.com/drive/folders/${ID}`), null);
});

test('changedFiles keeps only what Oru lacks, holds stale, or failed to index', () => {
  const files = [
    { id: 'same', modifiedTime: '2026-10-01T10:00:00.000Z' },
    { id: 'edited', modifiedTime: '2026-10-02T09:00:00.000Z' },
    { id: 'new', modifiedTime: '2026-10-02T09:00:00.000Z' },
    { id: 'failed', modifiedTime: '2026-10-01T10:00:00.000Z' },
  ];
  const known = { connectors: [{ documents: [
    { externalId: 'same', modifiedAt: '2026-10-01T10:00:00+00:00', status: 'indexed' },
    { externalId: 'edited', modifiedAt: '2026-10-01T10:00:00.000Z', status: 'indexed' },
    { externalId: 'failed', modifiedAt: '2026-10-01T10:00:00.000Z', status: 'skipped' },
  ] }] };
  assert.deepEqual(changedFiles(files, known).map((f) => f.id), ['edited', 'new', 'failed']);
});

test('toCsv quotes cells with commas, quotes or newlines', () => {
  assert.equal(toCsv([['Color', 'Hex'], ['Green, primary', '#569C79'], ['Say "hi"', 'a\nb']]),
    'Color,Hex\n"Green, primary",#569C79\n"Say ""hi""","a\nb"');
});

test('unzip reads stored and deflated entries', () => {
  for (const stored of [true, false]) {
    const entries = unzip(zip({ 'a.txt': 'hola', 'dir/b.xml': '<x/>' }, { stored }));
    assert.equal(entries.get('a.txt').toString(), 'hola');
    assert.equal(entries.get('dir/b.xml').toString(), '<x/>');
  }
});

test('docxText keeps paragraphs, tabs and entities', () => {
  const doc = zip({ 'word/document.xml': '<w:document><w:body>'
    + '<w:p><w:r><w:t>Brand guide</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t xml:space="preserve">Primary: </w:t></w:r><w:r><w:tab/><w:t>#569C79 &amp; warm</w:t></w:r></w:p>'
    + '</w:body></w:document>' });
  assert.equal(docxText(doc), 'Brand guide\nPrimary: \t#569C79 & warm');
});

test('pptxText orders slides by number, not by name', () => {
  const slide = (text) => `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
  const deck = zip({
    'ppt/slides/slide10.xml': slide('Ten'),
    'ppt/slides/slide2.xml': slide('Two'),
    'ppt/slides/slide1.xml': slide('One'),
  });
  assert.equal(pptxText(deck), '## Slide 1\nOne\n\n## Slide 2\nTwo\n\n## Slide 3\nTen');
});

test('xlsxText writes each sheet as CSV with shared and inline strings', () => {
  const book = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Colors" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Hex</t></si><si><t>Green, primary</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="inlineStr"><is><t>#569C79</t></is></c></row>'
      + '</sheetData></worksheet>',
  });
  assert.equal(xlsxText(book), '## Sheet: Colors\nName,Hex\n"Green, primary",,#569C79');
});

test('searchQuery escapes quotes and backslashes and leaves folders out', async () => {
  const { searchQuery } = await import('./drive-lib.mjs');
  assert.equal(searchQuery("brand 'v2' \\ guide"),
    "fullText contains 'brand \\'v2\\' \\\\ guide' and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
});
