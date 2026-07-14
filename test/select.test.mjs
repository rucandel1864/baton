import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-select-'));
const { upsertConversation } = await import('../src/store.mjs');
const { list, pick } = await import('../src/select.mjs');

// Seed: one CC conversation in /p1, one Codex conversation in /p2.
upsertConversation({ id: 'cc:A', source: 'claude-code', meta: { project: '/p1', title: 'cc one' }, messages: [{ role: 'user', parts: [{ t: 'text', text: 'one' }] }], mode: 'replace' });
upsertConversation({ id: 'codex:B', source: 'codex', meta: { project: '/p2', title: 'codex two' }, messages: [{ role: 'user', parts: [{ t: 'text', text: 'two' }] }], mode: 'replace' });

test('list filters by project', () => {
  assert.equal(list({ project: '/p1' }).length, 1);
  assert.equal(list({ project: '/p2' }).length, 1);
  assert.equal(list({}).length, 2);
});

test('pick returns the project match regardless of source (cross-tool)', () => {
  assert.equal(pick({ project: '/p1' }).id, 'cc:A'); // CC-sourced
  assert.equal(pick({ project: '/p2' }).id, 'codex:B'); // Codex-sourced
});

test('pick honors explicit id and 1-based index', () => {
  assert.equal(pick({ id: 'codex:B' }).id, 'codex:B');
  assert.equal(pick({ project: '/p1', index: 1 }).id, 'cc:A');
});

test('pick falls back to newest overall when project has no match', () => {
  const got = pick({ project: '/nonexistent' });
  assert.ok(got && (got.id === 'cc:A' || got.id === 'codex:B'));
});
