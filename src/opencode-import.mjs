// Import OpenCode conversations on demand by reading its SQLite DB.
// OpenCode has no capture hook, so (like Codex) we pull recent project-matching
// sessions at pickup time. Uses Node's built-in node:sqlite (Node >=22.5) —
// gated so older Node just skips OpenCode support gracefully.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { opencodeDb, pathRelated } from './paths.mjs';
import { readConversation, upsertConversation } from './store.mjs';
import { truncate } from './util.mjs';

const require = createRequire(import.meta.url);

function loadSqlite() {
  try {
    return require('node:sqlite'); // throws on Node <22.5 (module missing)
  } catch {
    return null;
  }
}

// OpenCode stores `session.model` as a JSON blob like
// {"id":"tencent/hy3:free","providerID":"openrouter",...}. Extract a readable id.
function cleanModel(m) {
  if (!m) return '';
  if (typeof m === 'object') return m.id || '';
  try {
    const o = JSON.parse(m);
    if (o && typeof o === 'object') return o.id || o.model || '';
  } catch {
    /* plain string */
  }
  return String(m);
}

function loadSession(db, s) {
  const msgs = db
    .prepare('SELECT id, data FROM message WHERE session_id=? ORDER BY time_created ASC, rowid ASC')
    .all(s.id);
  const partStmt = db.prepare('SELECT data FROM part WHERE message_id=? ORDER BY time_created ASC, rowid ASC');
  const messages = [];
  let title = '';

  for (const m of msgs) {
    let md;
    try {
      md = JSON.parse(m.data);
    } catch {
      continue;
    }
    const role = md.role === 'assistant' ? 'assistant' : 'user';
    const parts = [];
    for (const pr of partStmt.all(m.id)) {
      let pd;
      try {
        pd = JSON.parse(pr.data);
      } catch {
        continue;
      }
      if (pd.type === 'text') {
        if (pd.text && pd.text.trim()) parts.push({ t: 'text', text: pd.text });
      } else if (pd.type === 'tool') {
        parts.push({ t: 'tool_use', name: pd.tool || '', input: pd.state && pd.state.input });
        const out = pd.state && (pd.state.output ?? pd.state.result);
        if (out != null) {
          const tr = truncate(typeof out === 'string' ? out : JSON.stringify(out));
          parts.push({ t: 'tool_result', name: '', text: tr.text, truncated: tr.truncated });
        }
      }
      // step-start / reasoning / snapshot / patch parts are skipped
    }
    if (!parts.length) continue;
    if (role === 'user' && !title) {
      const ft = parts.find((p) => p.t === 'text');
      if (ft) title = ft.text.split('\n')[0].slice(0, 80).trim();
    }
    messages.push({ role, ts: '', parts });
  }
  return { messages, title };
}

export function importRecentOpencode(project, { limit = 40 } = {}) {
  if (!project) return { imported: 0, reason: 'no-project' };
  const dbPath = opencodeDb();
  if (!fs.existsSync(dbPath)) return { imported: 0, reason: 'no-db' };
  const sqlite = loadSqlite();
  if (!sqlite) return { imported: 0, reason: 'no-node-sqlite' };

  let db;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return { imported: 0, reason: 'open-failed' };
  }

  let imported = 0;
  try {
    const sessions = db
      .prepare('SELECT id, directory, title, time_updated, model FROM session ORDER BY time_updated DESC LIMIT ?')
      .all(limit);
    for (const s of sessions) {
      if (!s.directory || !pathRelated(s.directory, project)) continue;
      const id = 'opencode:' + s.id;
      const ex = readConversation(id);
      if (ex && ex.watermark === s.time_updated) continue; // unchanged since last import
      const { messages, title } = loadSession(db, s);
      if (!messages.length) continue;
      const goodTitle = s.title && !/^New session/i.test(s.title) ? s.title : title;
      upsertConversation({
        id,
        source: 'opencode',
        sourcePath: dbPath,
        meta: { project: s.directory, title: goodTitle, model: cleanModel(s.model) },
        messages,
        newOffset: s.time_updated,
        mode: 'replace',
      });
      imported++;
    }
  } catch {
    /* tolerate any schema drift */
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  return { imported };
}
