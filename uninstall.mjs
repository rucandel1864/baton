// Remove Baton's Claude Code Stop hook + /baton command and the Codex prompt.
// Leaves the ~/.baton store intact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCcRoots, codexHome, batonDir } from './src/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function stripBatonStop(settings) {
  const stop = settings?.hooks?.Stop;
  if (!Array.isArray(stop)) return false;
  let changed = false;
  const kept = [];
  for (const entry of stop) {
    const entryHasBaton =
      (typeof entry?.command === 'string' && entry.command.includes('baton.mjs')) ||
      (Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('baton.mjs')));
    if (entryHasBaton) {
      changed = true;
      continue;
    }
    kept.push(entry);
  }
  if (changed) {
    if (kept.length) settings.hooks.Stop = kept;
    else delete settings.hooks.Stop;
  }
  return changed;
}

export async function main({ args = {}, roots, codexPromptsDir } = {}) {
  const ccRoots = roots || discoverCcRoots();
  const removed = [];

  for (const ccRoot of ccRoots) {
    const settingsPath = path.join(ccRoot, 'settings.json');
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (stripBatonStop(settings)) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        removed.push(`Stop hook @ ${settingsPath}`);
      }
    } catch {
      /* no settings, nothing to strip */
    }
    const cmd = path.join(ccRoot, 'commands', 'baton.md');
    try {
      fs.unlinkSync(cmd);
      removed.push(cmd);
    } catch {
      /* not present */
    }
  }

  const promptPath = path.join(codexPromptsDir || path.join(codexHome(), 'prompts'), 'baton.md');
  try {
    fs.unlinkSync(promptPath);
    removed.push(promptPath);
  } catch {
    /* not present */
  }

  // Remove the staged engine copy (but keep conversations).
  if (!args['keep-engine']) {
    const engine = path.join(batonDir(), 'engine');
    try {
      fs.rmSync(engine, { recursive: true, force: true });
      if (!fs.existsSync(engine)) removed.push(engine);
    } catch {
      /* not present */
    }
  }

  const msg = removed.length
    ? 'Baton uninstalled. Removed:\n' + removed.map((r) => '  - ' + r).join('\n') + '\n(The ~/.baton store was left intact.)\n'
    : 'Baton: nothing to remove.\n';
  process.stdout.write(msg);
  return { removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ args: {} });
}
