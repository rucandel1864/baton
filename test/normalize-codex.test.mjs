import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCodexRollout } from '../src/normalize-codex.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const buf = fs.readFileSync(path.join(here, 'fixtures', 'codex-sample.jsonl'));

test('Codex parser: skips developer, env-context, event_msg, reasoning', () => {
  const { messages } = parseCodexRollout(buf);
  // Expect: user "Review the diff for me" + assistant (text + tool_use + tool_result)
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].parts[0].text, 'Review the diff for me');
});

test('Codex parser: assistant gets text, tool_use (parsed input), tool_result', () => {
  const { messages } = parseCodexRollout(buf);
  const asst = messages[1];
  assert.equal(asst.role, 'assistant');
  const kinds = asst.parts.map((p) => p.t);
  assert.deepEqual(kinds, ['text', 'tool_use', 'tool_result']);
  assert.equal(asst.parts[1].name, 'exec');
  assert.equal(asst.parts[1].input.command, 'git diff'); // JSON-string input parsed to object
  assert.match(asst.parts[2].text, /diff --git/);
});

test('Codex parser: meta has id, project, title', () => {
  const { meta } = parseCodexRollout(buf);
  assert.equal(meta.id, 'CX1');
  assert.equal(meta.project, '/home/u/proj');
  assert.equal(meta.title, 'Review the diff for me');
});
