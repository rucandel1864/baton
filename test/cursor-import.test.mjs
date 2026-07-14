import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqlite = null;
try {
  sqlite = require('node:sqlite');
} catch {
  /* Node < 22.5: Cursor support is skipped by design */
}

process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cur-store-'));
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cur-db-')), 'state.vscdb');
process.env.CURSOR_DB = dbPath;

const COMPOSER = 'aaaa1111-2222-3333-4444-555566667777';

if (sqlite) {
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
  const put = db.prepare('INSERT INTO cursorDiskKV VALUES (?,?)');

  const headers = [
    { bubbleId: 'b1', type: 1 },
    { bubbleId: 'b2', type: 2 },
    { bubbleId: 'b3', type: 2 }, // thinking-only, must be skipped
    { bubbleId: 'b4', type: 2 }, // tool call
  ];
  put.run(
    `composerData:${COMPOSER}`,
    JSON.stringify({
      composerId: COMPOSER,
      name: 'Fix the Cursor bug',
      createdAt: 1782308499859,
      lastUpdatedAt: 1782381406017,
      workspaceIdentifier: { id: 'w1', uri: { fsPath: '/proj/cur' } },
      modelConfig: { modelName: 'composer-2.5' },
      fullConversationHeadersOnly: headers,
    }),
  );
  put.run(`bubbleId:${COMPOSER}:b1`, JSON.stringify({ type: 1, text: 'Please fix the Cursor bug', createdAt: '2026-06-24T13:41:42.522Z' }));
  put.run(`bubbleId:${COMPOSER}:b2`, JSON.stringify({ type: 2, text: 'Looking into it.' }));
  put.run(`bubbleId:${COMPOSER}:b3`, JSON.stringify({ type: 2, text: '', thinking: { text: 'hmm' } }));
  put.run(
    `bubbleId:${COMPOSER}:b4`,
    JSON.stringify({
      type: 2,
      text: '',
      toolFormerData: { name: 'read_file', tool: 5, status: 'completed', rawArgs: '{"path":"src/x.ts"}', result: '{"contents":"the file body"}' },
    }),
  );
  // Cursor writes literal null composers for drafts — the importer must not choke.
  put.run('composerData:dead-draft', 'null');
  // A composer for another project — must be ignored.
  put.run(
    'composerData:other-proj',
    JSON.stringify({
      name: 'Other',
      lastUpdatedAt: 9,
      workspaceIdentifier: { uri: { fsPath: '/elsewhere' } },
      fullConversationHeadersOnly: [{ bubbleId: 'x', type: 1 }],
    }),
  );
  db.close();
}

const { importRecentCursor } = await import('../src/cursor-import.mjs');
const { readConversation } = await import('../src/store.mjs');

const skip = sqlite ? false : 'node:sqlite unavailable (Node < 22.5)';

test('imports a Cursor composer, normalizing text + tool bubbles', { skip }, () => {
  const r = importRecentCursor('/proj/cur');
  assert.equal(r.imported, 1);
  const conv = readConversation('cursor:' + COMPOSER);
  assert.equal(conv.source, 'cursor');
  assert.equal(conv.project, '/proj/cur');
  assert.equal(conv.model, 'composer-2.5');
  assert.equal(conv.title, 'Fix the Cursor bug');
  assert.equal(conv.messages.length, 3); // thinking-only bubble dropped
  assert.equal(conv.messages[0].role, 'user');
  assert.equal(conv.messages[0].parts[0].text, 'Please fix the Cursor bug');
  assert.equal(conv.messages[1].parts[0].text, 'Looking into it.');
  const toolMsg = conv.messages[2];
  assert.deepEqual(toolMsg.parts.map((p) => p.t), ['tool_use', 'tool_result']);
  assert.equal(toolMsg.parts[0].name, 'read_file');
  assert.equal(toolMsg.parts[0].input.path, 'src/x.ts');
  assert.match(toolMsg.parts[1].text, /the file body/);
});

test('Cursor import is idempotent (unchanged lastUpdatedAt skipped)', { skip }, () => {
  assert.equal(importRecentCursor('/proj/cur').imported, 0);
});

test('Cursor import ignores other projects and null composers', { skip }, () => {
  assert.equal(importRecentCursor('/somewhere/else').imported, 0);
});
