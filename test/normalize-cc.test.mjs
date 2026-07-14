import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCcTranscript } from '../src/normalize-cc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const buf = fs.readFileSync(path.join(here, 'fixtures', 'cc-sample.jsonl'));

test('CC parser: drops noise, meta, and command-wrapper lines', () => {
  const { messages } = parseCcTranscript(buf, 0);
  // Real messages only: user "Help me build a parser", assistant, tool_result user.
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].parts[0].text, 'Help me build a parser');
});

test('CC parser: assistant keeps text + tool_use, drops thinking by default', () => {
  const { messages } = parseCcTranscript(buf, 0);
  const asst = messages[1];
  assert.equal(asst.role, 'assistant');
  const kinds = asst.parts.map((p) => p.t);
  assert.deepEqual(kinds, ['text', 'tool_use']);
  assert.equal(asst.parts[1].name, 'Bash');
  assert.equal(asst.parts[1].input.command, 'ls -la');
});

test('CC parser: includeThinking keeps thinking parts', () => {
  const { messages } = parseCcTranscript(buf, 0, { includeThinking: true });
  const asst = messages[1];
  assert.ok(asst.parts.some((p) => p.t === 'thinking'));
});

test('CC parser: tool_result captured on following user message', () => {
  const { messages } = parseCcTranscript(buf, 0);
  const last = messages[2];
  assert.equal(last.parts[0].t, 'tool_result');
  assert.match(last.parts[0].text, /file1\nfile2/);
});

test('CC parser: meta has project, sessionId, title', () => {
  const { meta } = parseCcTranscript(buf, 0);
  assert.equal(meta.project, '/home/u/proj');
  assert.equal(meta.sessionId, 'S1');
  assert.equal(meta.title, 'Help me build a parser');
  assert.equal(meta.model, 'claude-opus-4-8');
});

test('CC parser: watermark consumes full buffer, and resuming yields nothing new', () => {
  const { newOffset } = parseCcTranscript(buf, 0);
  assert.equal(newOffset, buf.length);
  const again = parseCcTranscript(buf, newOffset);
  assert.equal(again.messages.length, 0);
  assert.equal(again.newOffset, buf.length);
});

test('CC parser: trailing partial line is not consumed', () => {
  const partial = Buffer.concat([buf, Buffer.from('{"type":"user","message":{"role":"user","content":"incomplete')]);
  const { newOffset } = parseCcTranscript(partial, 0);
  assert.equal(newOffset, buf.length); // stops at last newline
});
