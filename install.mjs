// Wire Baton into Claude Code (Stop hook + /baton command) and Codex (prompt).
// Idempotent. Backs up settings.json once before first modification.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCcRoots, codexHome } from './src/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fwd(p) {
  return p.replace(/\\/g, '/');
}

function readTemplate(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function stopHookHasBaton(settings) {
  const stop = settings?.hooks?.Stop;
  if (!Array.isArray(stop)) return false;
  for (const entry of stop) {
    if (typeof entry?.command === 'string' && entry.command.includes('baton.mjs')) return true;
    if (Array.isArray(entry?.hooks)) {
      for (const h of entry.hooks) {
        if (typeof h?.command === 'string' && h.command.includes('baton.mjs')) return true;
      }
    }
  }
  return false;
}

export async function main({ root = HERE, args = {}, roots, codexPromptsDir } = {}) {
  const dryRun = !!args['dry-run'];
  const binPath = fwd(path.join(root, 'bin', 'baton.mjs'));
  const hookCommand = `node "${binPath}" capture`;
  const ccRoots = roots || discoverCcRoots();
  const summary = { ccRoots: [], codexPrompt: null, dryRun };

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
    const already = stopHookHasBaton(settings);
    const record = { root: ccRoot, hook: already ? 'present' : 'added', command: path.join(ccRoot, 'commands', 'baton.md') };

    if (!already) {
      settings.hooks = settings.hooks || {};
      settings.hooks.Stop = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
      settings.hooks.Stop.push({ hooks: [{ type: 'command', command: hookCommand }] });
      if (!dryRun) {
        if (fs.existsSync(settingsPath) && !fs.existsSync(settingsPath + '.baton-bak')) {
          fs.copyFileSync(settingsPath, settingsPath + '.baton-bak');
        }
        fs.mkdirSync(ccRoot, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    }

    // Always (re)write the command file so it points at the current bin path.
    if (!dryRun) {
      const cmdDir = path.join(ccRoot, 'commands');
      fs.mkdirSync(cmdDir, { recursive: true });
      fs.writeFileSync(path.join(cmdDir, 'baton.md'), cmdTemplate);
    }
    summary.ccRoots.push(record);
  }

  // Codex prompt
  const promptsDir = codexPromptsDir || path.join(codexHome(), 'prompts');
  const promptPath = path.join(promptsDir, 'baton.md');
  if (!dryRun) {
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(promptPath, promptTemplate);
  }
  summary.codexPrompt = promptPath;

  printSummary(summary, binPath);
  return summary;
}

function printSummary(s, binPath) {
  const lines = [];
  lines.push(s.dryRun ? 'Baton install (dry run — nothing written):' : 'Baton installed.');
  lines.push(`  engine: ${binPath}`);
  if (s.ccRoots.length) {
    lines.push('  Claude Code:');
    for (const r of s.ccRoots) {
      lines.push(`    - ${r.root}  (Stop hook ${r.hook}, /baton command written)`);
    }
  } else {
    lines.push('  Claude Code: no config dirs found (looked for ~/.claude, ~/.claude-b, $CLAUDE_CONFIG_DIR).');
  }
  lines.push(`  Codex prompt: ${s.codexPrompt}`);
  lines.push('');
  lines.push('Capture is now automatic in Claude Code. In any new session (CC or Codex) run  /baton  to pick up.');
  process.stdout.write(lines.join('\n') + '\n');
}

// Allow `node install.mjs`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ args: Object.fromEntries(process.argv.slice(2).map((a) => [a.replace(/^--/, ''), true])) });
}
