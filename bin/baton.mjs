#!/usr/bin/env node
// Baton CLI — the single engine behind the Stop hook, the /baton slash command,
// and the Codex prompt. Zero dependencies.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function resolveProject(args) {
  const p = args.project;
  if (!p || p === true || p === '.') return process.cwd();
  return path.resolve(String(p));
}

function formatList(items) {
  if (!items.length) return 'Baton: no conversations yet.';
  const rows = items.map((it) => {
    const when = (it.updated || '').replace('T', ' ').slice(0, 16);
    return `${String(it.n).padStart(2)}. [${it.source}] ${it.title}  —  ${when}`;
  });
  return ['Recent Baton conversations (use `/baton <number>` to load one):', ...rows].join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (cmd) {
    case 'capture': {
      // Never print on success: Stop-hook stdout is injected as context.
      try {
        const { captureFile, captureFromHook } = await import('../src/capture.mjs');
        if (args.file) captureFile(path.resolve(String(args.file)), args.session);
        else captureFromHook(await readStdin());
      } catch {
        /* swallow — must never break a turn */
      }
      process.exit(0);
      break;
    }
    case 'render': {
      const { render } = await import('../src/render.mjs');
      const { list, refresh } = await import('../src/select.mjs');
      const project = resolveProject(args);
      refresh(project);
      const arg = typeof args.arg === 'string' ? args.arg.trim() : '';
      if (arg.toLowerCase() === 'list') {
        process.stdout.write(formatList(list({ project })) + '\n');
        break;
      }
      const index = /^\d+$/.test(arg) ? parseInt(arg, 10) : undefined;
      const out = render({
        project,
        id: args.id && args.id !== true ? String(args.id) : undefined,
        index,
        maxTokens: args['max-tokens'] ? parseInt(String(args['max-tokens']), 10) : undefined,
        redact: args['no-redact'] ? false : undefined,
      });
      process.stdout.write(out);
      break;
    }
    case 'list': {
      const { list, refresh } = await import('../src/select.mjs');
      const project = args.all ? undefined : resolveProject(args);
      refresh(project || process.cwd());
      const items = list({ project });
      if (args.json) process.stdout.write(JSON.stringify(items, null, 2) + '\n');
      else process.stdout.write(formatList(items) + '\n');
      break;
    }
    case 'to-codex': {
      const { pick } = await import('../src/select.mjs');
      const { exportToCodex } = await import('../src/export-codex.mjs');
      const project = resolveProject(args);
      const arg = typeof args.arg === 'string' ? args.arg.trim() : '';
      const conv = pick({
        project,
        id: args.id && args.id !== true ? String(args.id) : undefined,
        index: /^\d+$/.test(arg) ? parseInt(arg, 10) : undefined,
      });
      if (!conv) {
        process.stdout.write(`Baton: no conversation found for ${project} to export.\n`);
        break;
      }
      const r = exportToCodex(conv);
      process.stdout.write(
        `Wrote a resumable Codex session.\n` +
          `  In the Codex app: open the sessions/resume list and pick  "${r.threadName}"\n` +
          `  file: ${r.file}\n`,
      );
      break;
    }
    case 'install': {
      const mod = await import('../install.mjs');
      await mod.main({ root: ROOT, args });
      break;
    }
    case 'uninstall': {
      const mod = await import('../uninstall.mjs');
      await mod.main({ root: ROOT, args });
      break;
    }
    case 'render-latest': // alias
    case undefined:
    case 'help':
    case '--help':
    case '-h': {
      process.stdout.write(
        [
          'baton — portable conversation-context bus',
          '',
          'Usage:',
          '  baton capture [--file <transcript>]   Mirror a CC transcript (Stop hook uses stdin)',
          '  baton render  [--project <dir>] [--arg <list|N>] [--id <id>] [--max-tokens N] [--no-redact]',
          '  baton list    [--project <dir>|--all] [--json]',
          '  baton to-codex [--project <dir>] [--arg N] [--id <id>]   Write a resumable native Codex session',
          '  baton install [--dry-run]             Wire hook + /baton into Claude Code & Codex',
          '  baton uninstall',
          '',
        ].join('\n'),
      );
      break;
    }
    default: {
      process.stderr.write(`baton: unknown command "${cmd}". Try "baton help".\n`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  process.stderr.write('baton error: ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});
