// Canonical store on disk: ~/.baton/{index.json, config.json, conversations/<id>.json}
// Zero dependencies. Atomic writes via tmp + rename.
import fs from 'node:fs';
import path from 'node:path';
import { batonDir } from './paths.mjs';

const DEFAULT_CONFIG = { redact: true, maxTokens: 150000, includeThinking: false };

function convDir() {
  return path.join(batonDir(), 'conversations');
}
function indexPath() {
  return path.join(batonDir(), 'index.json');
}
function configPath() {
  return path.join(batonDir(), 'config.json');
}
export function safeName(id) {
  return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_');
}
function convPath(id) {
  return path.join(convDir(), safeName(id) + '.json');
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(p, obj, pretty) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Math.floor(process.hrtime()[1])}`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  fs.renameSync(tmp, p);
}

export function ensureStore() {
  fs.mkdirSync(convDir(), { recursive: true });
  if (!fs.existsSync(indexPath())) writeJson(indexPath(), [], true);
  if (!fs.existsSync(configPath())) writeJson(configPath(), DEFAULT_CONFIG, true);
}

export function readConfig() {
  return { ...DEFAULT_CONFIG, ...(readJson(configPath(), {}) || {}) };
}

export function readIndex() {
  return readJson(indexPath(), []) || [];
}

export function readConversation(id) {
  return readJson(convPath(id), null);
}

function upsertIndex(entry) {
  const idx = readIndex().filter((e) => e.id !== entry.id);
  idx.push(entry);
  idx.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  writeJson(indexPath(), idx, true);
}

export function writeConversation(conv) {
  ensureStore();
  writeJson(convPath(conv.id), conv, false);
  upsertIndex({
    id: conv.id,
    source: conv.source,
    project: conv.project,
    title: conv.title,
    updated: conv.updated,
    model: conv.model || '',
    path: convPath(conv.id),
  });
  return conv;
}

// Merge a capture into the store.
// mode 'append'  -> add messages to the end (CC incremental capture)
// mode 'replace' -> replace all messages (Codex full re-parse)
export function upsertConversation({ id, source, sourcePath, meta = {}, messages = [], newOffset, mode = 'append' }) {
  ensureStore();
  const now = new Date().toISOString();
  let conv = readConversation(id);
  if (!conv) {
    conv = {
      id,
      source,
      sourcePath: sourcePath || '',
      project: meta.project || '',
      model: meta.model || '',
      title: meta.title || '',
      created: meta.created || now,
      updated: now,
      watermark: 0,
      messages: [],
    };
  }
  conv.messages = mode === 'replace' ? messages : conv.messages.concat(messages);
  if (newOffset != null) conv.watermark = newOffset;
  // Project + title are first-seen-wins so they don't drift as a session's cwd
  // moves between subdirectories mid-conversation.
  if (meta.project && !conv.project) conv.project = meta.project;
  if (meta.model) conv.model = meta.model;
  if (meta.title && !conv.title) conv.title = meta.title;
  if (sourcePath) conv.sourcePath = sourcePath;
  conv.updated = now;
  return writeConversation(conv);
}
