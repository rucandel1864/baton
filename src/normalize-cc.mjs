// Claude Code transcript normalizer.
//
// The CC .jsonl format is officially "internal and may change between
// versions." This module is therefore deliberately TOLERANT: it skips unknown
// line types and never throws on a bad line. If CC changes its format, this is
// the ONLY file that needs to change.
//
// Incremental capture: parse only bytes from `fromOffset` to the last complete
// line, and return `newOffset` so the caller can persist a watermark. CC
// transcripts are append-only during a session, so this is safe.
import { truncate, stringifyContent } from './util.mjs';

// User "messages" that are really slash-command / local-command UI wrappers.
const COMMAND_WRAP = /^<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|user-prompt-submit-hook)>/;

export function parseCcTranscript(buffer, fromOffset = 0, opts = {}) {
  const includeThinking = !!opts.includeThinking;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
  const region = buf.slice(fromOffset).toString('utf8');

  // Only consume through the last newline; a trailing partial line is left for
  // next time so the watermark never splits a JSON object.
  const lastNl = region.lastIndexOf('\n');
  const consumed = lastNl === -1 ? '' : region.slice(0, lastNl + 1);
  const newOffset = fromOffset + Buffer.byteLength(consumed, 'utf8');

  const messages = [];
  const meta = {};

  for (const line of consumed.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // tolerate malformed lines
    }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    if (o.isMeta) continue;
    const m = o.message;
    if (!m) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';

    const parts = [];
    const content = m.content;
    if (typeof content === 'string') {
      const text = content;
      if (text.trim() && !COMMAND_WRAP.test(text.trim())) parts.push({ t: 'text', text });
    } else if (Array.isArray(content)) {
      for (const p of content) {
        if (!p || typeof p !== 'object') continue;
        if (p.type === 'text') {
          if (p.text && !COMMAND_WRAP.test(p.text.trim())) parts.push({ t: 'text', text: p.text });
        } else if (p.type === 'thinking') {
          if (includeThinking && p.thinking) parts.push({ t: 'thinking', text: p.thinking });
        } else if (p.type === 'tool_use') {
          parts.push({ t: 'tool_use', name: p.name || '', input: p.input });
        } else if (p.type === 'tool_result') {
          const tr = truncate(stringifyContent(p.content));
          parts.push({ t: 'tool_result', name: '', text: tr.text, truncated: tr.truncated });
        }
      }
    }
    if (!parts.length) continue;

    if (!meta.project && o.cwd) meta.project = o.cwd;
    if (!meta.sessionId && o.sessionId) meta.sessionId = o.sessionId;
    if (!meta.created && o.timestamp) meta.created = o.timestamp;
    if (!meta.model && m.model && m.model !== '<synthetic>') meta.model = m.model;
    if (!meta.title && role === 'user') {
      const ft = parts.find((x) => x.t === 'text');
      if (ft) meta.title = ft.text.split('\n')[0].slice(0, 80).trim();
    }

    messages.push({ role, ts: o.timestamp || '', parts });
  }

  return { messages, meta, newOffset };
}
