// Codex rollout normalizer.
//
// Codex rollout .jsonl lines are all `{timestamp, type, payload}`. Like the CC
// parser, this is TOLERANT: unknown types are skipped, bad lines never throw.
// Codex re-parses the whole file each import (no incremental watermark), so the
// caller upserts with mode 'replace'.
import { truncate, safeParse } from './util.mjs';

const WRAPPER = /^<(environment_context|permissions instructions|user_instructions)/;

export function parseCodexRollout(buffer) {
  const text = (Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
  const messages = [];
  const meta = {};
  let pendingAssistant = null; // assistant message to attach tool calls/results to

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const type = o.type;
    const payload = o.payload || {};

    if (type === 'session_meta') {
      if (!meta.id && payload.id) meta.id = payload.id;
      if (!meta.created && (payload.timestamp || o.timestamp)) meta.created = payload.timestamp || o.timestamp;
      if (!meta.project && payload.cwd) meta.project = payload.cwd;
      continue;
    }
    if (type === 'turn_context') {
      if (payload.cwd && !meta.project) meta.project = payload.cwd;
      continue;
    }
    if (type !== 'response_item') continue; // skip event_msg + anything else

    const p = payload;
    if (p.type === 'message') {
      const role = p.role;
      if (role === 'developer') continue;
      const text2 = (Array.isArray(p.content) ? p.content : [])
        .map((c) => (c && c.text != null ? c.text : ''))
        .join('')
        .trim();
      if (!text2) continue;
      if (role === 'user' && WRAPPER.test(text2)) continue;
      const norm = role === 'assistant' ? 'assistant' : 'user';
      const msg = { role: norm, ts: o.timestamp || '', parts: [{ t: 'text', text: text2 }] };
      messages.push(msg);
      if (norm === 'assistant') pendingAssistant = msg;
      if (norm === 'user' && !meta.title) meta.title = text2.split('\n')[0].slice(0, 80).trim();
    } else if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      const call = { t: 'tool_use', name: p.name || 'exec', input: safeParse(p.input ?? p.arguments) };
      if (pendingAssistant) pendingAssistant.parts.push(call);
      else {
        const msg = { role: 'assistant', ts: o.timestamp || '', parts: [call] };
        messages.push(msg);
        pendingAssistant = msg;
      }
    } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
      const raw = Array.isArray(p.output)
        ? p.output.map((c) => (c && c.text != null ? c.text : typeof c === 'string' ? c : '')).join('\n')
        : typeof p.output === 'string'
          ? p.output
          : JSON.stringify(p.output ?? '');
      const tr = truncate(raw);
      const part = { t: 'tool_result', name: '', text: tr.text, truncated: tr.truncated };
      if (pendingAssistant) pendingAssistant.parts.push(part);
      else messages.push({ role: 'assistant', ts: o.timestamp || '', parts: [part] });
    }
    // reasoning (encrypted) intentionally skipped
  }

  return { messages, meta };
}
