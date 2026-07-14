import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-render-'));
const { upsertConversation } = await import('../src/store.mjs');
const { render } = await import('../src/render.mjs');

test('render on empty store returns a friendly not-found message', () => {
  const out = render({ project: '/empty/proj' });
  assert.match(out, /no saved conversation/i);
});

test('render reproduces the conversation as markdown', () => {
  upsertConversation({
    id: 'cc:R1',
    source: 'claude-code',
    meta: { project: '/proj/r', title: 'Build the thing' },
    messages: [
      { role: 'user', parts: [{ t: 'text', text: 'Build the thing please' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'On it.' }, { t: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
      { role: 'assistant', parts: [{ t: 'tool_result', name: '', text: 'file1\nfile2', truncated: false }] },
    ],
    mode: 'replace',
  });
  const out = render({ project: '/proj/r' });
  assert.match(out, /Continuing a prior conversation/);
  assert.match(out, /Build the thing please/);
  assert.match(out, /On it\./);
  assert.match(out, /Bash\(/);
  assert.match(out, /file1/);
});

test('tool output containing ``` cannot break out of its code fence', () => {
  upsertConversation({
    id: 'cc:R3',
    source: 'claude-code',
    meta: { project: '/proj/fence', title: 'fences' },
    messages: [
      { role: 'assistant', parts: [{ t: 'tool_result', name: '', text: 'before\n```js\nembedded();\n```\nafter', truncated: false }] },
    ],
    mode: 'replace',
  });
  const out = render({ project: '/proj/fence' });
  // The wrapping fence must be longer than the embedded ``` run.
  assert.match(out, /````\nbefore\n```js/);
  assert.match(out, /```\nafter\n````/);
});

test('render redacts secrets by default and not when disabled', () => {
  upsertConversation({
    id: 'cc:R2',
    source: 'claude-code',
    meta: { project: '/proj/secret', title: 'secret' },
    messages: [{ role: 'user', parts: [{ t: 'text', text: 'my key is sk-ant-abcdefghij1234567890zz' }] }],
    mode: 'replace',
  });
  assert.match(render({ project: '/proj/secret' }), /«redacted:anthropic-key»/);
  assert.match(render({ project: '/proj/secret', redact: false }), /sk-ant-abcdefghij/);
});
