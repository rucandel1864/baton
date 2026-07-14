// Import Codex rollouts into the store on demand (Codex has no capture hook).
// Bounded, newest-first scan; peek cwd cheaply, full-parse only project matches;
// skip files whose mtime is unchanged since last import.
import fs from 'node:fs';
import path from 'node:path';
import { codexHome, samePath } from './paths.mjs';
import { parseCodexRollout } from './normalize-codex.mjs';
import { readConversation, upsertConversation } from './store.mjs';

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function sortedDesc(dir) {
  try {
    return fs.readdirSync(dir).sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

function newestRolloutFiles(limit) {
  const out = [];
  const sess = path.join(codexHome(), 'sessions');
  for (const y of sortedDesc(sess)) {
    for (const mo of sortedDesc(path.join(sess, y))) {
      for (const d of sortedDesc(path.join(sess, y, mo))) {
        const dir = path.join(sess, y, mo, d);
        for (const f of sortedDesc(dir)) {
          if (/^rollout-.*\.jsonl$/.test(f)) {
            out.push(path.join(dir, f));
            if (out.length >= limit) return out;
          }
        }
      }
    }
  }
  const arch = path.join(codexHome(), 'archived_sessions');
  for (const f of sortedDesc(arch)) {
    if (/^rollout-.*\.jsonl$/.test(f)) {
      out.push(path.join(arch, f));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function idFromFilename(file) {
  const m = path.basename(file).match(UUID_RE);
  return m ? m[1] : null;
}

// Cheaply read the head of a rollout to find its cwd without full parse.
function peekProject(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.slice(0, n).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('cwd')) continue;
      try {
        const o = JSON.parse(line);
        const p = o.payload || {};
        if (p.cwd) return p.cwd;
      } catch {
        /* partial last line, ignore */
      }
    }
  } catch {
    return null;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
  return null;
}

export function importRecentCodex(project, { maxScan = 80 } = {}) {
  if (!project) return { imported: 0, scanned: 0 };
  const files = newestRolloutFiles(maxScan);
  let imported = 0;
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const bareId = idFromFilename(file);
    if (bareId) {
      const ex = readConversation('codex:' + bareId);
      if (ex && ex.watermark === stat.mtimeMs) continue; // unchanged, already imported
    }
    const peeked = peekProject(file);
    if (peeked && !samePath(peeked, project)) continue;

    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    const { messages, meta } = parseCodexRollout(buf);
    if (!meta.project || !samePath(meta.project, project)) continue;
    if (!messages.length) continue;
    const id = 'codex:' + (meta.id || bareId || path.basename(file));
    upsertConversation({
      id,
      source: 'codex',
      sourcePath: file,
      meta,
      messages,
      newOffset: stat.mtimeMs,
      mode: 'replace',
    });
    imported++;
  }
  return { imported, scanned: files.length };
}
