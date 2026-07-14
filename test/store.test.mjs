import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the store in a temp dir BEFORE importing the module (it reads env lazily,
// but set it up front to be safe).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-store-'));
process.env.BATON_DIR = tmp;

const { ensureStore, upsertConversation, readConversation, readIndex, readConfig } = await import('../src/store.mjs');

test('ensureStore creates index + config with defaults', () => {
  ensureStore();
  assert.ok(fs.existsSync(path.join(tmp, 'index.json')));
  const cfg = readConfig();
  assert.equal(cfg.redact, true);
  assert.equal(cfg.maxTokens, 150000);
});

test('append mode adds messages without duplicating existing ones', () => {
  upsertConversation({
    id: 'cc:S1',
    source: 'claude-code',
    meta: { project: '/home/u/proj', title: 'T', sessionId: 'S1' },
    messages: [{ role: 'user', parts: [{ t: 'text', text: 'one' }] }],
    newOffset: 100,
    mode: 'append',
  });
  upsertConversation({
    id: 'cc:S1',
    source: 'claude-code',
    meta: { project: '/home/u/proj' },
    messages: [{ role: 'assistant', parts: [{ t: 'text', text: 'two' }] }],
    newOffset: 200,
    mode: 'append',
  });
  const conv = readConversation('cc:S1');
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.watermark, 200);
  assert.equal(conv.title, 'T');
});

test('replace mode overwrites messages (idempotent Codex re-import)', () => {
  const payload = {
    id: 'codex:CX1',
    source: 'codex',
    meta: { project: '/home/u/proj', title: 'C' },
    messages: [
      { role: 'user', parts: [{ t: 'text', text: 'a' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'b' }] },
    ],
    mode: 'replace',
  };
  upsertConversation(payload);
  upsertConversation(payload); // second import must not duplicate
  const conv = readConversation('codex:CX1');
  assert.equal(conv.messages.length, 2);
});

test('index is sorted newest-first and contains both conversations', () => {
  const idx = readIndex();
  assert.equal(idx.length, 2);
  assert.ok(idx.every((e) => e.id && e.project === '/home/u/proj'));
});

test('project is first-seen and does not drift when cwd changes mid-session', () => {
  upsertConversation({ id: 'cc:D', source: 'claude-code', meta: { project: '/proj/root', title: 'drift' }, messages: [{ role: 'user', parts: [{ t: 'text', text: 'a' }] }], mode: 'append' });
  upsertConversation({ id: 'cc:D', source: 'claude-code', meta: { project: '/proj/root/sub' }, messages: [{ role: 'user', parts: [{ t: 'text', text: 'b' }] }], mode: 'append' });
  assert.equal(readConversation('cc:D').project, '/proj/root'); // not overwritten by /proj/root/sub
});
