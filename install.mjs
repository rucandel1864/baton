// Wire Baton into Claude Code (Stop hook + /baton command) and Codex (prompt).
// Idempotent and self-staging: the engine is copied into ~/.baton/engine/ so the
// installed hook/command/prompt reference a STABLE path even if this repo (or an
// npx cache) is later deleted. Re-running always converges to the current version.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCcRoots, codexHome, batonDir, normPath } from './src/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE_ITEMS = ['bin', 'src', 'commands', 'prompts', 'install.mjs', 'uninstall.mjs', 'package.json'];

function fwd(p) {
  return p.replace(/\\/g, '/');
}
function copyRec(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) copyRec(path.join(from, e), path.join(to, e));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
function stageEngine(root) {
  const dest = path.join(batonDir(), 'engine');
  if (normPath(root) === normPath(dest)) return dest; // already running from the staged copy
  for (const item of STAGE_ITEMS) {
    const from = path.join(root, item);
    if (fs.existsSync(from)) copyRec(from, path.join(dest, item));
  }
  return dest;
}
function readTemplate(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function entryHasBaton(entry) {
  if (typeof entry?.command === 'string' && entry.command.includes('baton.mjs')) return true;
  return Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('baton.mjs'));
}

export async function main({ root = HERE, args = {}, roots, codexPromptsDir, stage = true } = {}) {
  const dryRun = !!args['dry-run'];
  const engineRoot = stage && !dryRun ? stageEngine(root) : root;
  const binPath = fwd(path.join(engineRoot, 'bin', 'baton.mjs'));
  const hookCommand = `node "${binPath}" capture`;
  const ccRoots = roots || discoverCcRoots();
  const summary = { engineRoot, binPath, ccRoots: [], codexPrompt: null, dryRun };

  const cmdTemplate = readTemplate(root, path.join('commands', 'baton.md')).replaceAll('__BATON_BIN__', binPath);
  const promptTemplate = readTemplate(root, path.join('prompts', 'baton.md')).replaceAll('__BATON_BIN__', binPath);

  for (const ccRoot of ccRoots) {
    const settingsPath = path.join(ccRoot, 'settings.json');
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = {};
    }
    settings.hooks = settings.hooks || {};
    const prevStop = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
    const filtered = prevStop.filter((e) => !entryHasBaton(e)); // drop any prior baton entry
    const wasPresent = filtered.length !== prevStop.length;
    filtered.push({ hooks: [{ type: 'command', command: hookCommand }] });
    settings.hooks.Stop = filtered;

    if (!dryRun) {
      if (fs.existsSync(settingsPath) && !fs.existsSync(settingsPath + '.baton-bak')) {
        fs.copyFileSync(settingsPath, settingsPath + '.baton-bak');
      }
      fs.mkdirSync(ccRoot, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      const cmdDir = path.join(ccRoot, 'commands');
      fs.mkdirSync(cmdDir, { recursive: true });
      fs.writeFileSync(path.join(cmdDir, 'baton.md'), cmdTemplate);
    }
    summary.ccRoots.push({ root: ccRoot, hook: wasPresent ? 'updated' : 'added' });
  }

  const promptsDir = codexPromptsDir || path.join(codexHome(), 'prompts');
  const promptPath = path.join(promptsDir, 'baton.md');
  if (!dryRun) {
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(promptPath, promptTemplate);
  }
  summary.codexPrompt = promptPath;

  printSummary(summary);
  return summary;
}

function printSummary(s) {
  const lines = [];
  lines.push(s.dryRun ? 'Baton install (dry run — nothing written):' : 'Baton installed.');
  lines.push(`  engine (stable): ${s.binPath}`);
  if (s.ccRoots.length) {
    lines.push('  Claude Code:');
    for (const r of s.ccRoots) lines.push(`    - ${r.root}  (Stop hook ${r.hook}, /baton command written)`);
  } else {
    lines.push('  Claude Code: no config dirs found (looked for ~/.claude, ~/.claude-b, $CLAUDE_CONFIG_DIR).');
  }
  lines.push(`  Codex prompt: ${s.codexPrompt}`);
  lines.push('');
  lines.push('Capture is automatic in Claude Code. In any new session (CC or Codex) run  /baton  to pick up.');
  lines.push('(Restart the Codex desktop app once so it loads the new /baton prompt.)');
  process.stdout.write(lines.join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ args: Object.fromEntries(process.argv.slice(2).map((a) => [a.replace(/^--/, ''), true])) });
}
