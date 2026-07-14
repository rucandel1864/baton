import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-x2c-codex-'));
process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-x2c-store-'));

const { exportToCodex } = await import('../src/export-codex.mjs');
const { parseCodexRollout } = await import('../src/normalize-codex.mjs');

const conv = {
  id: 'cc:X1',
  source: 'claude-code',
  project: '/proj/x2c',
  title: 'Build baton',
  messages: [
    { role: 'user', parts: [{ t: 'text', text: 'Build the baton tool' }] },
    { role: 'assistant', parts: [{ t: 'text', text: 'Sure.' }, { t: 'tool_use', name: 'Write', input: { file: 'a' } }] },
    { role: 'assistant', parts: [{ t: 'tool_result', name: '', text: 'wrote a', truncated: false }] },
  ],
};

test('exportToCodex writes a resumable session file and indexes it', () => {
  const r = exportToCodex({ ...conv }, { now: 1781900000000 });
  assert.ok(fs.existsSync(r.file), 'rollout file written');
  assert.match(path.basename(r.file), /^rollout-.*\.jsonl$/);
  assert.match(r.threadName, /Baton: Build baton/);

  // session_index.jsonl updated with our id
  const idx = fs.readFileSync(path.join(process.env.CODEX_HOME, 'session_index.jsonl'), 'utf8');
  assert.ok(idx.includes(r.id));
});

test('the reconstructed session is a valid top-level session that round-trips', () => {
  const r = exportToCodex({ ...conv, id: 'cc:X2' }, { now: 1781900001000 });
  const buf = fs.readFileSync(r.file);
  const first = JSON.parse(buf.toString('utf8').split('\n')[0]);
  assert.equal(first.type, 'session_meta');
  assert.equal(first.payload.thread_source, 'user');
  assert.equal(first.payload.cwd, '/proj/x2c');
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/.test(first.payload.id), 'id is a UUIDv7');

  // Our own Codex parser can read it back with the messages intact.
  const { messages, meta } = parseCodexRollout(buf);
  assert.equal(meta.project, '/proj/x2c');
  assert.ok(messages.some((m) => m.role === 'user' && m.parts[0].text.includes('Build the baton tool')));
  assert.ok(messages.some((m) => m.role === 'assistant' && m.parts.some((p) => p.text && p.text.includes('Sure.'))));
});
