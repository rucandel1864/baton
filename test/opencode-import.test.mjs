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
  /* Node < 22.5: OpenCode support is skipped by design */
}

process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-oc-store-'));
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'baton-oc-db-')), 'opencode.db');
process.env.OPENCODE_DB = dbPath;

if (sqlite) {
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_updated INTEGER, model TEXT);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, time_created INTEGER, data TEXT);
  `);
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?)').run('ses_1', '/proj/oc', 'New session - 2026', 1000, 'gpt-5.5');
  db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m1', 'ses_1', 1, JSON.stringify({ role: 'user' }));
  db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m2', 'ses_1', 2, JSON.stringify({ role: 'assistant' }));
  db.prepare('INSERT INTO part VALUES (?,?,?,?)').run('p1', 'm1', 1, JSON.stringify({ type: 'text', text: 'Fix the OpenCode bug' }));
  db.prepare('INSERT INTO part VALUES (?,?,?,?)').run('p2', 'm2', 2, JSON.stringify({ type: 'text', text: 'On it.' }));
  db.prepare('INSERT INTO part VALUES (?,?,?,?)').run('p3', 'm2', 3, JSON.stringify({ type: 'tool', tool: 'read', state: { input: { filePath: 'x' }, output: 'file contents here' } }));
  db.close();
}

const { importRecentOpencode } = await import('../src/opencode-import.mjs');
const { readConversation } = await import('../src/store.mjs');

const skip = sqlite ? false : 'node:sqlite unavailable (Node < 22.5)';

test('imports an OpenCode session, normalizing text + tool parts', { skip }, () => {
  const r = importRecentOpencode('/proj/oc');
  assert.equal(r.imported, 1);
  const conv = readConversation('opencode:ses_1');
  assert.equal(conv.source, 'opencode');
  assert.equal(conv.project, '/proj/oc');
  assert.equal(conv.model, 'gpt-5.5');
  assert.equal(conv.title, 'Fix the OpenCode bug'); // auto "New session" title replaced by first user line
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.messages[0].parts[0].text, 'Fix the OpenCode bug');
  const asst = conv.messages[1];
  const kinds = asst.parts.map((p) => p.t);
  assert.deepEqual(kinds, ['text', 'tool_use', 'tool_result']);
  assert.equal(asst.parts[1].name, 'read');
  assert.equal(asst.parts[1].input.filePath, 'x');
  assert.match(asst.parts[2].text, /file contents here/);
});

test('OpenCode import is idempotent (unchanged time_updated skipped)', { skip }, () => {
  assert.equal(importRecentOpencode('/proj/oc').imported, 0);
});

test('OpenCode import ignores other projects', { skip }, () => {
  assert.equal(importRecentOpencode('/somewhere/else').imported, 0);
});
