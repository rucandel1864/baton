#!/usr/bin/env node
// Baton CLI — the single engine behind the Stop hook, the /baton slash command,
// and the Codex prompt. Zero dependencies.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Piping output through `head`-like consumers closes stdout early; that's
// normal CLI life, not an error.
process.stdout.on('error', (e) => {
  if (e && e.code === 'EPIPE') process.exit(0);
});

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
    case 'copy': {
      // Universal handoff: render + put on the OS clipboard, so ANY tool with a
      // paste box (other CLIs, web chats) can pick up the conversation.
      const { render } = await import('../src/render.mjs');
      const { refresh } = await import('../src/select.mjs');
      const { copyToClipboard } = await import('../src/clipboard.mjs');
      const { estimateTokens } = await import('../src/tokens.mjs');
      const project = resolveProject(args);
      refresh(project);
      const arg = typeof args.arg === 'string' ? args.arg.trim() : '';
      const out = render({
        project,
        id: args.id && args.id !== true ? String(args.id) : undefined,
        index: /^\d+$/.test(arg) ? parseInt(arg, 10) : undefined,
        maxTokens: args['max-tokens'] ? parseInt(String(args['max-tokens']), 10) : undefined,
        redact: args['no-redact'] ? false : undefined,
      });
      if (/^_Baton: no saved conversation/.test(out)) {
        process.stdout.write(out);
        break;
      }
      const r = copyToClipboard(out);
      if (r.ok) {
        process.stdout.write(`Baton: handoff copied to clipboard (~${estimateTokens(out).toLocaleString()} tokens, via ${r.method}).\nPaste it as the first message of your new session — any tool, any model.\n`);
      } else {
        process.stderr.write('Baton: no clipboard tool found (tried the OS default' + (process.platform === 'linux' ? ', wl-copy, xclip, xsel' : '') + ').\n');
        process.stderr.write('Fallback:  baton render > handoff.md   then paste/attach that file.\n');
        process.exitCode = 1;
      }
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
    case 'hide':
    case 'unhide': {
      // Hide (or restore) a conversation from list/pick — e.g. test noise.
      // Requires an explicit target: an index from `baton list`, or --id.
      const { list } = await import('../src/select.mjs');
      const { setHidden } = await import('../src/store.mjs');
      const hidden = cmd === 'hide';
      const project = resolveProject(args);
      let id = args.id && args.id !== true ? String(args.id) : undefined;
      const nArg = args._[0] != null ? String(args._[0]) : typeof args.arg === 'string' ? args.arg.trim() : '';
      if (!id && /^\d+$/.test(nArg)) {
        const items = list({ project });
        const n = parseInt(nArg, 10);
        if (n >= 1 && n <= items.length) id = items[n - 1].id;
      }
      if (!id) {
        process.stderr.write(`baton ${cmd}: give an explicit target — a number from \`baton list\`, or --id <id>.\n`);
        process.exitCode = 1;
        break;
      }
      const conv = setHidden(id, hidden);
      if (!conv) {
        process.stderr.write(`baton ${cmd}: no conversation with id ${id}.\n`);
        process.exitCode = 1;
        break;
      }
      process.stdout.write(`Baton: ${hidden ? 'hid' : 'restored'} "${conv.title || conv.id}" (${conv.id}).\n`);
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
          '  baton copy    [same options as render]    Render + copy to the OS clipboard (works with ANY tool)',
          '  baton list    [--project <dir>|--all] [--json]',
          '  baton hide <n>|--id <id>              Hide a conversation from list/pick (unhide to restore)',
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
