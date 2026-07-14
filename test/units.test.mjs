import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sanitizeCwd, samePath, normPath, pathRelated } from '../src/paths.mjs';
import { estimateTokens, compact } from '../src/tokens.mjs';
import { redactSecrets } from '../src/redact.mjs';

test('sanitizeCwd matches CC dir encoding', () => {
  assert.equal(
    sanitizeCwd('C:\\Users\\sneak\\OneDrive\\Desktop\\investing'),
    'C--Users-sneak-OneDrive-Desktop-investing',
  );
});

test('samePath is case- and separator-insensitive on win32-style input', () => {
  // normPath resolves relative to cwd; feed already-absolute posix-ish paths.
  assert.ok(samePath('/home/u/proj', '/home/u/proj/'));
  assert.equal(normPath('/home/u/proj/'), normPath('/home/u/proj'));
});

test('pathRelated matches a project and its subdirectories, not siblings', () => {
  const root = process.cwd();
  const sub = path.join(root, 'baton');
  const sibling = path.join(path.dirname(root), 'other-proj');
  assert.ok(pathRelated(root, sub)); // parent <-> child
  assert.ok(pathRelated(sub, root));
  assert.ok(pathRelated(root, root));
  assert.ok(!pathRelated(root, sibling));
});

test('estimateTokens ~ chars/4', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  assert.equal(estimateTokens(''), 0);
});

test('compact keeps small transcripts untouched', () => {
  const msgs = [{ role: 'user', parts: [{ t: 'text', text: 'hi' }] }];
  const { messages, compacted } = compact(msgs, 1000);
  assert.equal(compacted, false);
  assert.equal(messages.length, 1);
});

test('compact summarizes oldest and keeps newest verbatim under budget', () => {
  const big = 'x'.repeat(8000); // ~2000 tokens each
  const msgs = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: 'user', parts: [{ t: 'text', text: `ask ${i} ${big}` }] });
    msgs.push({ role: 'assistant', parts: [{ t: 'text', text: `answer ${i} ${big}` }] });
  }
  const { messages, compacted } = compact(msgs, 4000);
  assert.equal(compacted, true);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].parts[0].text, /earlier message/i);
  // newest message preserved verbatim
  const last = messages[messages.length - 1];
  assert.match(last.parts[0].text, /answer 9/);
});

test('redactSecrets masks high-confidence patterns, leaves prose', () => {
  assert.match(redactSecrets('key sk-ant-abc123def456ghi789jkl'), /«redacted:anthropic-key»/);
  assert.match(redactSecrets('AKIAIOSFODNN7EXAMPLE'), /«redacted:aws-akia»/);
  assert.match(redactSecrets('api_key="ABCD1234EFGH5678IJKL"'), /«redacted:secret»/);
  assert.equal(redactSecrets('just normal words here'), 'just normal words here');
});
