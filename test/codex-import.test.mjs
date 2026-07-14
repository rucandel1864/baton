import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-codexhome-'));
process.env.CODEX_HOME = codexHome;
process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-codeximp-'));

const { importRecentCodex } = await import('../src/codex-import.mjs');
const { readConversation, readIndex } = await import('../src/store.mjs');

const PROJECT = '/proj/cx';
const dayDir = path.join(codexHome, 'sessions', '2026', '07', '14');
fs.mkdirSync(dayDir, { recursive: true });
const rollout = path.join(dayDir, 'rollout-2026-07-14T10-00-00-019eda81-89a3-7102-8f08-790efd0deaaa.jsonl');

const lines = [
  { timestamp: 't', type: 'session_meta', payload: { id: '019eda81-89a3-7102-8f08-790efd0deaaa', timestamp: '2026-07-14T10:00:00Z' } },
  { timestamp: 't', type: 'turn_context', payload: { turn_id: 'x', cwd: PROJECT, workspace_roots: [PROJECT] } },
  { timestamp: 't', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'from codex side' }] } },
  { timestamp: 't', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex reply' }] } },
];
fs.writeFileSync(rollout, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');

test('importRecentCodex imports a project-matching rollout', () => {
  const r = importRecentCodex(PROJECT);
  assert.equal(r.imported, 1);
  const conv = readConversation('codex:019eda81-89a3-7102-8f08-790efd0deaaa');
  assert.ok(conv);
  assert.equal(conv.source, 'codex');
  assert.equal(conv.project, PROJECT);
  assert.equal(conv.title, 'from codex side');
});

test('importRecentCodex is idempotent (unchanged mtime skipped)', () => {
  const r = importRecentCodex(PROJECT);
  assert.equal(r.imported, 0);
  assert.equal(readIndex().length, 1);
});

test('importRecentCodex ignores rollouts from other projects', () => {
  process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-codeximp2-'));
  const r = importRecentCodex('/some/other/project');
  assert.equal(r.imported, 0);
});
