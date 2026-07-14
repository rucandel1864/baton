// Render a selected conversation to Markdown for injection into a new session.
import { pick } from './select.mjs';
import { readConfig } from './store.mjs';
import { compact } from './tokens.mjs';
import { redactSecrets } from './redact.mjs';
import { previewInput } from './util.mjs';

export function renderConversation(conv, { maxTokens, redact }) {
  const { messages, compacted } = compact(conv.messages || [], maxTokens);
  const L = [];
  L.push('# ⟵ Continuing a prior conversation (via Baton)');
  L.push('');
  const modelBit = conv.model ? ` · model: ${conv.model}` : '';
  L.push(`**Source:** ${conv.source}${modelBit}  ·  **Project:** ${conv.project || 'unknown'}  ·  **Updated:** ${conv.updated || ''}`);
  if (compacted) L.push('');
  if (compacted) L.push('> _Older turns were compacted to fit this model\'s context window; the most recent turns are verbatim._');
  L.push('');
  L.push(
    'You are picking up **this exact conversation**. Read it fully and continue seamlessly — do not greet, re-introduce, or re-ask anything already covered below. Treat prior assistant turns as your own.',
  );
  L.push('');
  L.push('---');

  for (const m of messages) {
    const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Context';
    L.push('');
    L.push(`## ${who}`);
    for (const p of m.parts || []) {
      if (p.t === 'text') {
        L.push(p.text);
      } else if (p.t === 'thinking') {
        L.push(`> _(thinking)_ ${p.text}`);
      } else if (p.t === 'tool_use') {
        L.push(`\`↳ ${p.name}(${previewInput(p.input)})\``);
      } else if (p.t === 'tool_result') {
        L.push('```');
        L.push(p.text);
        L.push('```');
        if (p.truncated) L.push('_(tool output truncated by baton)_');
      }
    }
  }
  let out = L.join('\n') + '\n';
  if (redact) out = redactSecrets(out);
  return out;
}

export function render({ project, id, index, maxTokens, redact } = {}) {
  const cfg = readConfig();
  const conv = pick({ project, id, index });
  if (!conv) {
    return `_Baton: no saved conversation found${project ? ` for \`${project}\`` : ''}. Capture is automatic in Claude Code — once you've had a conversation, it'll be here. Try \`baton list\` to see all._\n`;
  }
  return renderConversation(conv, {
    maxTokens: maxTokens || cfg.maxTokens,
    redact: redact != null ? redact : cfg.redact,
  });
}
