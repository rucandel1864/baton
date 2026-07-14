import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cap-'));
const { captureFromHook, captureFile } = await import('../src/capture.mjs');
const { readConversation } = await import('../src/store.mjs');

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cap-tx-'));
const tx = path.join(workdir, 'session.jsonl');

function line(o) {
  return JSON.stringify(o) + '\n';
}
const base = { cwd: '/proj/cap', sessionId: 'CAP1' };
function userMsg(text, ts) {
  return line({ type: 'user', message: { role: 'user', content: text }, ...base, timestamp: ts });
}
function asstMsg(text, ts) {
  return line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...base, timestamp: ts });
}

test('captureFromHook mirrors a transcript into the store', () => {
  fs.writeFileSync(tx, userMsg('hello there', '2026-07-14T01:00:00Z') + asstMsg('hi back', '2026-07-14T01:00:01Z'));
  const r = captureFromHook(JSON.stringify({ transcript_path: tx, session_id: 'CAP1', hook_event_name: 'Stop' }));
  assert.equal(r.ok, true);
  const conv = readConversation('cc:CAP1');
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.project, '/proj/cap');
  assert.equal(conv.title, 'hello there');
  assert.ok(conv.watermark > 0);
});

test('incremental capture appends only new turns', () => {
  const before = readConversation('cc:CAP1').watermark;
  fs.appendFileSync(tx, userMsg('a follow-up question', '2026-07-14T01:00:02Z'));
  const r = captureFromHook(JSON.stringify({ transcript_path: tx, session_id: 'CAP1' }));
  assert.equal(r.added, 1); // only the one new message parsed
  const conv = readConversation('cc:CAP1');
  assert.equal(conv.messages.length, 3);
  assert.ok(conv.watermark > before);
});

test('re-capture with no new bytes is a no-op', () => {
  const r = captureFromHook(JSON.stringify({ transcript_path: tx, session_id: 'CAP1' }));
  assert.equal(r.reason, 'no-change');
  assert.equal(readConversation('cc:CAP1').messages.length, 3);
});

test('transcript shrinking (rotation/rewrite) rewinds the watermark and replaces', () => {
  // Same session id, but the file is now SMALLER than the stored watermark.
  fs.writeFileSync(tx, userMsg('rewritten', '2026-07-14T02:00:00Z'));
  const r = captureFromHook(JSON.stringify({ transcript_path: tx, session_id: 'CAP1' }));
  assert.equal(r.ok, true);
  assert.notEqual(r.reason, 'no-change'); // must NOT get stuck
  const conv = readConversation('cc:CAP1');
  assert.equal(conv.messages.length, 1); // replaced, not appended (no duplicates)
  assert.equal(conv.messages[0].parts[0].text, 'rewritten');
  assert.equal(conv.watermark, fs.statSync(tx).size);
});

test('bad hook input never throws', () => {
  assert.doesNotThrow(() => captureFromHook('not json'));
  assert.doesNotThrow(() => captureFromHook(JSON.stringify({})));
  assert.equal(captureFile('/no/such/file.jsonl').ok, false);
});
