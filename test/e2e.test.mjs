// End-to-end: capture a CC transcript, then render it back — the full pickup path.
// Plus a cross-tool check: a Codex-sourced conversation rendered for a CC pickup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-e2e-codex-'));
process.env.CODEX_HOME = codexHome;
process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-e2e-'));

const { captureFromHook } = await import('../src/capture.mjs');
const { render } = await import('../src/render.mjs');
const { importRecentCodex } = await import('../src/codex-import.mjs');

const PROJECT = '/proj/e2e';

test('CC capture -> render round-trip reproduces the conversation', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-e2e-tx-'));
  const tx = path.join(wd, 's.jsonl');
  const l = (o) => JSON.stringify(o) + '\n';
  const b = { cwd: PROJECT, sessionId: 'E2E1' };
  fs.writeFileSync(
    tx,
    l({ type: 'user', message: { role: 'user', content: 'Design the baton tool' }, ...b, timestamp: '2026-07-14T02:00:00Z' }) +
      l({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the design.' }, { type: 'tool_use', id: 't1', name: 'Write', input: { file: 'x' } }] }, ...b, timestamp: '2026-07-14T02:00:01Z' }) +
      l({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'wrote x' }] }, ...b, timestamp: '2026-07-14T02:00:02Z' }),
  );
  const r = captureFromHook(JSON.stringify({ transcript_path: tx, session_id: 'E2E1' }));
  assert.equal(r.ok, true);

  const out = render({ project: PROJECT });
  assert.match(out, /Design the baton tool/);
  assert.match(out, /Here is the design\./);
  assert.match(out, /Write\(/);
  assert.match(out, /wrote x/);
});

test('Codex -> CC pickup: a Codex-sourced conversation renders for the same project', () => {
  const dayDir = path.join(codexHome, 'sessions', '2026', '07', '14');
  fs.mkdirSync(dayDir, { recursive: true });
  const file = path.join(dayDir, 'rollout-2026-07-14T09-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');
  const l = (o) => JSON.stringify(o) + '\n';
  fs.writeFileSync(
    file,
    l({ type: 'session_meta', payload: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', timestamp: '2026-07-14T09:00:00Z' } }) +
      l({ type: 'turn_context', payload: { cwd: PROJECT } }) +
      l({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'work done in codex' }] } }) +
      l({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex finished the task' }] } }),
  );
  const imp = importRecentCodex(PROJECT);
  assert.equal(imp.imported, 1);

  const out = render({ project: PROJECT, id: 'codex:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assert.match(out, /Source:\*\* codex/);
  assert.match(out, /work done in codex/);
  assert.match(out, /codex finished the task/);
});
