import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-select-'));
const { upsertConversation, setHidden } = await import('../src/store.mjs');
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

// The feedback-loop bug: a session created BY a /baton pickup must not shadow
// the conversation it was loaded from.
test('a pickup-husk session is hidden from list/pick', () => {
  upsertConversation({
    id: 'cursor:HUSK',
    source: 'cursor',
    meta: { project: '/p1', title: 'baton' },
    messages: [
      { role: 'user', parts: [{ t: 'text', text: 'Run this in the terminal:\nnode "/x/baton.mjs" render --project .' }] },
      { role: 'assistant', parts: [{ t: 'tool_use', name: 'run_terminal', input: { command: 'node /x/baton.mjs render' } }, { t: 'tool_result', name: '', text: '# ⟵ Continuing a prior conversation (via Baton)\n...the injected transcript...' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'Caught up on the project — ready to continue.' }] },
    ],
    mode: 'replace',
  });
  // Despite being newest, the husk is invisible; the real conversation wins.
  assert.equal(pick({ project: '/p1' }).id, 'cc:A');
  assert.ok(!list({ project: '/p1' }).some((e) => e.id === 'cursor:HUSK'));
});

// Cursor stores the slash command literally as "/baton" (not the expanded
// command file) and narrates around it — narration must not count as substance.
test('a Cursor-style pickup (literal /baton + assistant narration) is a husk', () => {
  upsertConversation({
    id: 'cursor:HUSK2',
    source: 'cursor',
    meta: { project: '/p1', title: 'baton' },
    messages: [
      { role: 'user', parts: [{ t: 'text', text: '/baton' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'Loading the prior conversation with Baton.' }] },
      { role: 'assistant', parts: [{ t: 'tool_use', name: 'run_terminal_cmd', input: { command: 'node "C:/Users/x/.baton/engine/bin/baton.mjs" render --project .' } }, { t: 'tool_result', name: '', text: '# ⟵ Continuing a prior conversation (via Baton)\n…' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'The /baton command executed, but the history is nearly empty.' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'Caught up on the Baton handoff for this project — ready to continue.' }] },
    ],
    mode: 'replace',
  });
  assert.equal(pick({ project: '/p1' }).id, 'cc:A');
  assert.ok(!list({ project: '/p1' }).some((e) => e.id === 'cursor:HUSK2'));
});

test('a husk becomes visible once real work continues in it', () => {
  upsertConversation({
    id: 'cursor:HUSK',
    source: 'cursor',
    meta: { project: '/p1' },
    messages: [
      { role: 'user', parts: [{ t: 'text', text: 'Great — now refactor the auth module like we discussed.' }] },
      { role: 'assistant', parts: [{ t: 'text', text: 'Refactoring auth now. Here is the plan…' }] },
      { role: 'user', parts: [{ t: 'text', text: 'Looks good, apply it.' }] },
    ],
    mode: 'append',
  });
  assert.equal(pick({ project: '/p1' }).id, 'cursor:HUSK'); // now the legit latest
});

test('hide removes a conversation from list/pick; the flag survives re-import; unhide restores', () => {
  assert.ok(setHidden('cursor:HUSK', true));
  assert.equal(pick({ project: '/p1' }).id, 'cc:A');
  assert.ok(!list({ project: '/p1' }).some((e) => e.id === 'cursor:HUSK'));
  // Source tool re-imports the same conversation — hidden must stick.
  upsertConversation({
    id: 'cursor:HUSK',
    source: 'cursor',
    meta: { project: '/p1' },
    messages: [{ role: 'user', parts: [{ t: 'text', text: 'more work' }] }],
    mode: 'replace',
  });
  assert.ok(!list({ project: '/p1' }).some((e) => e.id === 'cursor:HUSK'));
  setHidden('cursor:HUSK', false);
  assert.equal(pick({ project: '/p1' }).id, 'cursor:HUSK');
});
