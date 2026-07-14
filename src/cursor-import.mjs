// Import Cursor conversations on demand by reading its global SQLite DB
// (%APPDATA%/Cursor/User/globalStorage/state.vscdb and platform equivalents).
// Cursor stores each conversation ("composer") as JSON in the cursorDiskKV
// table: `composerData:<id>` holds metadata + the ordered list of bubble ids,
// and `bubbleId:<composerId>:<bubbleId>` holds each message. Bubble type 1 is
// the user, type 2 the assistant; tool calls ride on `toolFormerData`.
// Uses Node's built-in node:sqlite (Node >=22.5) — gated so older Node just
// skips Cursor support gracefully, same as the OpenCode adapter.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { cursorGlobalDb, pathRelated } from './paths.mjs';
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

function bubbleParts(b) {
  const parts = [];
  if (b.text && b.text.trim()) parts.push({ t: 'text', text: b.text });
  const tf = b.toolFormerData;
  if (tf && (tf.name || tf.rawArgs)) {
    let input = tf.rawArgs;
    try {
      input = JSON.parse(tf.rawArgs);
    } catch {
      /* keep raw string */
    }
    parts.push({ t: 'tool_use', name: tf.name || '', input });
    if (tf.result != null && tf.result !== '') {
      const tr = truncate(typeof tf.result === 'string' ? tf.result : JSON.stringify(tf.result));
      parts.push({ t: 'tool_result', name: '', text: tr.text, truncated: tr.truncated });
    }
  }
  return parts;
}

function loadComposer(db, composerId, cd) {
  const bubbleStmt = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
  const messages = [];
  let title = '';
  for (const h of cd.fullConversationHeadersOnly || []) {
    if (!h || !h.bubbleId) continue;
    const row = bubbleStmt.get(`bubbleId:${composerId}:${h.bubbleId}`);
    if (!row || !row.value) continue;
    let b;
    try {
      b = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!b || (b.type !== 1 && b.type !== 2)) continue;
    const role = b.type === 1 ? 'user' : 'assistant';
    const parts = bubbleParts(b);
    if (!parts.length) continue; // thinking-only / empty bubbles
    if (role === 'user' && !title) {
      const ft = parts.find((p) => p.t === 'text');
      if (ft) title = ft.text.split('\n')[0].slice(0, 80).trim();
    }
    messages.push({ role, ts: b.createdAt || '', parts });
  }
  return { messages, title };
}

// `limit` bounds the metadata scan, not imports — the scan is cheap (SQL-side
// json_extract, no blob parsing), and project filtering happens after it, so
// keep it generous or busy multi-project machines would miss older sessions.
export function importRecentCursor(project, { limit = 200 } = {}) {
  if (!project) return { imported: 0, reason: 'no-project' };
  const dbPath = cursorGlobalDb();
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
    // Metadata via json_extract so we never JSON.parse the (large) composer
    // blobs that don't match this project. Some values are literal `null`.
    const composers = db
      .prepare(
        `SELECT key,
                json_extract(value, '$.name') AS name,
                json_extract(value, '$.lastUpdatedAt') AS updated,
                json_extract(value, '$.workspaceIdentifier.uri.fsPath') AS fsPath,
                json_extract(value, '$.modelConfig.modelName') AS model,
                json_array_length(value, '$.fullConversationHeadersOnly') AS n
         FROM cursorDiskKV
         WHERE key LIKE 'composerData:%' AND value IS NOT NULL AND json_valid(value)
         ORDER BY updated DESC
         LIMIT ?`,
      )
      .all(limit);

    for (const c of composers) {
      if (!c.n || !c.fsPath || !pathRelated(c.fsPath, project)) continue;
      const composerId = String(c.key).slice('composerData:'.length);
      const id = 'cursor:' + composerId;
      const ex = readConversation(id);
      if (ex && ex.watermark === c.updated) continue; // unchanged since last import
      const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(c.key);
      let cd;
      try {
        cd = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (!cd) continue;
      const { messages, title } = loadComposer(db, composerId, cd);
      if (!messages.length) continue;
      upsertConversation({
        id,
        source: 'cursor',
        sourcePath: dbPath,
        meta: {
          project: c.fsPath,
          title: c.name || title,
          model: c.model && c.model !== 'default' ? c.model : '',
          created: cd.createdAt ? new Date(cd.createdAt).toISOString() : undefined,
        },
        messages,
        newOffset: c.updated,
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
