// Reconstruct a NATIVE, resumable Codex session from a Baton conversation.
// The result appears in the Codex app's "resume" list as real message history —
// no prompt, no command. To stay version-compatible, template fields
// (cli_version, originator, base_instructions, model, timezone…) are copied from
// the user's newest real Codex session at export time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { codexHome as defaultCodexHome } from './paths.mjs';
import { newestRolloutFiles } from './codex-import.mjs';
import { readConfig, writeConversation } from './store.mjs';
import { compact } from './tokens.mjs';
import { redactSecrets } from './redact.mjs';
import { previewInput } from './util.mjs';

// UUIDv7 (time-ordered) — matches Codex's id format (48-bit ms + version 7).
function uuidv7(ms) {
  const b = crypto.randomBytes(16);
  const t = BigInt(ms);
  b[0] = Number((t >> 40n) & 0xffn);
  b[1] = Number((t >> 32n) & 0xffn);
  b[2] = Number((t >> 24n) & 0xffn);
  b[3] = Number((t >> 16n) & 0xffn);
  b[4] = Number((t >> 8n) & 0xffn);
  b[5] = Number(t & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Copy session_meta + turn_context fields from the newest real session so our
// reconstructed file matches the installed Codex version.
function readTemplates() {
  for (const f of newestRolloutFiles(10)) {
    try {
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
      const first = JSON.parse(lines[0]);
      if (first.type !== 'session_meta') continue;
      let tc = null;
      for (const l of lines) {
        const o = JSON.parse(l);
        if (o.type === 'turn_context') {
          tc = o.payload;
          break;
        }
      }
      return { meta: first.payload || {}, tc };
    } catch {
      /* try the next file */
    }
  }
  return { meta: {}, tc: null };
}

function partsToText(m) {
  const out = [];
  for (const p of m.parts || []) {
    if (p.t === 'text') out.push(p.text);
    else if (p.t === 'thinking') out.push('(thinking) ' + p.text);
    else if (p.t === 'tool_use') out.push(`[tool: ${p.name}(${previewInput(p.input)})]`);
    else if (p.t === 'tool_result') out.push('[tool result]\n' + p.text);
  }
  return out.join('\n\n').trim();
}

export function exportToCodex(conv, opts = {}) {
  const home = opts.codexHome || defaultCodexHome();
  const cfg = readConfig();
  const { meta: tmeta, tc: ttc } = readTemplates();
  const ms = opts.now || Date.now();
  const id = conv.codexResumeId || uuidv7(ms);
  const iso = new Date(ms).toISOString();
  const cwd = conv.project || process.cwd();

  const lines = [];
  const metaPayload = {
    session_id: id,
    id,
    timestamp: iso,
    cwd,
    originator: tmeta.originator || 'Codex Desktop',
    cli_version: tmeta.cli_version || '0.0.0',
    source: typeof tmeta.source === 'string' ? tmeta.source : 'vscode',
    thread_source: 'user',
    model_provider: tmeta.model_provider || 'openai',
  };
  if (tmeta.base_instructions) metaPayload.base_instructions = tmeta.base_instructions;
  lines.push({ timestamp: iso, type: 'session_meta', payload: metaPayload });

  const tcPayload = {
    turn_id: uuidv7(ms),
    cwd,
    workspace_roots: [cwd],
    current_date: iso.slice(0, 10),
  };
  if (ttc) {
    for (const k of ['timezone', 'approval_policy', 'sandbox_policy', 'model', 'effort', 'personality', 'summary']) {
      if (ttc[k] !== undefined) tcPayload[k] = ttc[k];
    }
  }
  lines.push({ timestamp: iso, type: 'turn_context', payload: tcPayload });

  const { messages } = compact(conv.messages || [], cfg.maxTokens);
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let text = partsToText(m);
    if (!text) continue;
    if (cfg.redact) text = redactSecrets(text);
    lines.push({
      timestamp: iso,
      type: 'response_item',
      payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] },
    });
  }

  const yyyy = iso.slice(0, 4);
  const mm = iso.slice(5, 7);
  const dd = iso.slice(8, 10);
  const stamp = iso.replace(/:/g, '-').replace(/\..*/, '');
  const dir = path.join(home, 'sessions', yyyy, mm, dd);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${stamp}-${id}.jsonl`);
  fs.writeFileSync(file, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');

  const threadName = `⟵ Baton: ${conv.title || 'handoff'}`.slice(0, 120);
  appendIndex(home, { id, thread_name: threadName, updated_at: iso });

  if (!conv.codexResumeId) {
    conv.codexResumeId = id;
    try {
      writeConversation(conv);
    } catch {
      /* store update is best-effort */
    }
  }
  return { file, id, threadName };
}

function appendIndex(home, entry) {
  const idxPath = path.join(home, 'session_index.jsonl');
  try {
    const existing = fs.existsSync(idxPath) ? fs.readFileSync(idxPath, 'utf8') : '';
    if (existing.includes(`"${entry.id}"`)) return;
    fs.appendFileSync(idxPath, JSON.stringify(entry) + '\n');
  } catch {
    /* index is best-effort; the session file is the source of truth */
  }
}
