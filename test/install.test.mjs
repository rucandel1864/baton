import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Isolate the staged engine (~/.baton/engine) into a temp dir.
process.env.BATON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-install-store-'));

const install = await import('../install.mjs');
const uninstall = await import('../uninstall.mjs');

const ccRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cc-'));
const codexPromptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cxp-'));
fs.writeFileSync(path.join(ccRoot, 'settings.json'), JSON.stringify({ model: 'fable' }, null, 2));

function readSettings() {
  return JSON.parse(fs.readFileSync(path.join(ccRoot, 'settings.json'), 'utf8'));
}

test('install wires Stop hook + /baton command + codex prompt', async () => {
  await install.main({ root: repoRoot, roots: [ccRoot], codexPromptsDir, args: {} });
  const s = readSettings();
  assert.ok(Array.isArray(s.hooks.Stop));
  const cmds = s.hooks.Stop.flatMap((e) => (e.hooks || []).map((h) => h.command));
  assert.ok(cmds.some((c) => c.includes('baton.mjs') && c.includes('capture')));
  assert.equal(s.model, 'fable'); // preserved existing settings

  const cmdFile = fs.readFileSync(path.join(ccRoot, 'commands', 'baton.md'), 'utf8');
  assert.match(cmdFile, /name: baton/);
  assert.match(cmdFile, /bin\/baton\.mjs/);
  assert.ok(!cmdFile.includes('__BATON_BIN__')); // placeholder substituted

  const prompt = fs.readFileSync(path.join(codexPromptsDir, 'baton.md'), 'utf8');
  assert.match(prompt, /render --project/);
  assert.ok(!prompt.includes('__BATON_BIN__'));

  // Engine staged to a stable location, and the hook points at it.
  const stagedBin = path.join(process.env.BATON_DIR, 'engine', 'bin', 'baton.mjs');
  assert.ok(fs.existsSync(stagedBin), 'engine staged to ~/.baton/engine');
  assert.ok(cmds.some((c) => c.includes('/engine/')), 'hook references the staged engine');
});

test('install is idempotent (no duplicate Stop hook)', async () => {
  await install.main({ root: repoRoot, roots: [ccRoot], codexPromptsDir, args: {} });
  const s = readSettings();
  const batonEntries = s.hooks.Stop.filter((e) => (e.hooks || []).some((h) => h.command.includes('baton.mjs')));
  assert.equal(batonEntries.length, 1);
  assert.ok(fs.existsSync(path.join(ccRoot, 'settings.json.baton-bak')));
});

test('uninstall removes hook + command + prompt, leaves other settings', async () => {
  await uninstall.main({ roots: [ccRoot], codexPromptsDir, args: {} });
  const s = readSettings();
  const stop = s.hooks && s.hooks.Stop ? s.hooks.Stop : [];
  assert.ok(!stop.some((e) => (e.hooks || []).some((h) => h.command.includes('baton.mjs'))));
  assert.equal(s.model, 'fable');
  assert.ok(!fs.existsSync(path.join(ccRoot, 'commands', 'baton.md')));
  assert.ok(!fs.existsSync(path.join(codexPromptsDir, 'baton.md')));
});
