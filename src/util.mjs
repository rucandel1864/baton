// Small shared helpers. Zero dependencies.

export const TOOL_OUTPUT_MAX = 20000;

// Truncate long strings (e.g. tool output) so the store stays bounded.
// Returns { text, truncated }.
export function truncate(s, max = TOOL_OUTPUT_MAX) {
  const str = s == null ? '' : String(s);
  if (str.length <= max) return { text: str, truncated: false };
  return { text: str.slice(0, max) + '\n…[truncated by baton]', truncated: true };
}

// Best-effort flatten of a tool-result "content" value into plain text.
export function stringifyContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') return c.text != null ? c.text : JSON.stringify(c);
        return String(c);
      })
      .join('\n');
  }
  if (typeof content === 'object') return content.text != null ? content.text : JSON.stringify(content);
  return String(content);
}

// Parse a value that may already be an object or a JSON string.
export function safeParse(v) {
  if (v == null) return v;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

// The heading baton render prints at the top of every injected transcript.
// Its presence inside a captured message means that message is Baton pickup
// mechanics, not real conversation.
export const BATON_MARKER = 'Continuing a prior conversation (via Baton)';

// True when a conversation is nothing but the mechanics of a Baton pickup:
// the /baton command text, the injected transcript, and the "caught up" ack.
// Without this filter a pickup session immediately becomes the project's
// "most recent" conversation and the NEXT /baton loads the husk instead of
// the real conversation it shadowed (a feedback loop). A husk stops being a
// husk once the user actually continues working in it — then it's the
// legitimate latest conversation.
export function isPickupHusk(conv) {
  let echo = 0;
  let substance = 0;
  for (const m of conv.messages || []) {
    if (m.role === 'system') continue;
    const isEcho = (m.parts || []).some((p) => {
      const t = p.text != null ? p.text : p.t === 'tool_use' ? JSON.stringify(p.input || '') : '';
      return t.includes(BATON_MARKER) || t.includes('baton.mjs');
    });
    if (isEcho) echo++;
    else substance++;
  }
  return echo > 0 && substance < 3;
}

// Compact one-line preview of a tool-call input for rendering.
export function previewInput(input, max = 200) {
  let s;
  if (input == null) s = '';
  else if (typeof input === 'string') s = input;
  else s = JSON.stringify(input);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}
