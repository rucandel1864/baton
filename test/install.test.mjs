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
const codexSkillsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'baton-cxs-')), 'baton');
const opencodeCommandDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-occ-'));
const cursorCommandDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-curc-'));
fs.writeFileSync(path.join(ccRoot, 'settings.json'), JSON.stringify({ model: 'fable' }, null, 2));

function readSettings() {
  return JSON.parse(fs.readFileSync(path.join(ccRoot, 'settings.json'), 'utf8'));
}

test('install wires Stop hook + /baton command + codex prompt', async () => {
  await install.main({ root: repoRoot, roots: [ccRoot], codexPromptsDir, codexSkillsDir, opencodeCommandDir, cursorCommandDir, args: {} });
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

  // Codex skill (desktop-app path) written with substituted bin.
  const skill = fs.readFileSync(path.join(codexSkillsDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /name: baton/);
  assert.match(skill, /render --project/);
  assert.ok(!skill.includes('__BATON_BIN__'));

  // OpenCode custom command (inline-shell injection).
  const oc = fs.readFileSync(path.join(opencodeCommandDir, 'baton.md'), 'utf8');
  assert.match(oc, /!`node /);
  assert.match(oc, /render --project/);
  assert.ok(!oc.includes('__BATON_BIN__'));

  // Cursor custom command.
  const cur = fs.readFileSync(path.join(cursorCommandDir, 'baton.md'), 'utf8');
  assert.match(cur, /render --project/);
  assert.ok(!cur.includes('__BATON_BIN__'));

  // Engine staged to a stable location, and the hook points at it.
  const stagedBin = path.join(process.env.BATON_DIR, 'engine', 'bin', 'baton.mjs');
  assert.ok(fs.existsSync(stagedBin), 'engine staged to ~/.baton/engine');
  assert.ok(cmds.some((c) => c.includes('/engine/')), 'hook references the staged engine');
});

test('install is idempotent (no duplicate Stop hook)', async () => {
  await install.main({ root: repoRoot, roots: [ccRoot], codexPromptsDir, codexSkillsDir, opencodeCommandDir, cursorCommandDir, args: {} });
  const s = readSettings();
  const batonEntries = s.hooks.Stop.filter((e) => (e.hooks || []).some((h) => h.command.includes('baton.mjs')));
  assert.equal(batonEntries.length, 1);
  assert.ok(fs.existsSync(path.join(ccRoot, 'settings.json.baton-bak')));
});

test('npm "files" whitelist ships every template install.mjs reads', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const needed of ['bin', 'src', 'commands', 'prompts', 'codex-skill', 'opencode-command', 'cursor-command', 'install.mjs', 'uninstall.mjs']) {
    assert.ok(pkg.files.includes(needed), `package.json files must include "${needed}" or npx install breaks`);
  }
});

test('re-install from the STAGED engine works (all templates staged)', async () => {
  const stagedRoot = path.join(process.env.BATON_DIR, 'engine');
  for (const t of ['commands/baton.md', 'prompts/baton.md', 'codex-skill/SKILL.md', 'opencode-command/baton.md', 'cursor-command/baton.md']) {
    assert.ok(fs.existsSync(path.join(stagedRoot, ...t.split('/'))), `staged engine missing template ${t}`);
  }
  // Running install with root = staged engine must not throw and must converge.
  await install.main({ root: stagedRoot, roots: [ccRoot], codexPromptsDir, codexSkillsDir, opencodeCommandDir, args: {} });
  const s = readSettings();
  const batonEntries = s.hooks.Stop.filter((e) => (e.hooks || []).some((h) => h.command.includes('baton.mjs')));
  assert.equal(batonEntries.length, 1);
});

test('uninstall removes hook + command + prompt, leaves other settings', async () => {
  await uninstall.main({ roots: [ccRoot], codexPromptsDir, codexSkillsDir, opencodeCommandDir, cursorCommandDir, args: {} });
  const s = readSettings();
  const stop = s.hooks && s.hooks.Stop ? s.hooks.Stop : [];
  assert.ok(!stop.some((e) => (e.hooks || []).some((h) => h.command.includes('baton.mjs'))));
  assert.equal(s.model, 'fable');
  assert.ok(!fs.existsSync(path.join(ccRoot, 'commands', 'baton.md')));
  assert.ok(!fs.existsSync(path.join(codexPromptsDir, 'baton.md')));
  assert.ok(!fs.existsSync(path.join(codexSkillsDir, 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(opencodeCommandDir, 'baton.md')));
  assert.ok(!fs.existsSync(path.join(cursorCommandDir, 'baton.md')));
});
