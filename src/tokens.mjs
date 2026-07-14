// Fast, dependency-free token estimation + transcript compaction.
// We deliberately avoid a real tokenizer: this runs on the hot path and a
// char/4 heuristic with margin is plenty to decide when to compact.

export function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / 4);
}

function messageText(m) {
  return (m.parts || [])
    .map((p) => {
      if (p.text != null) return p.text;
      if (p.input != null) return typeof p.input === 'string' ? p.input : JSON.stringify(p.input);
      return '';
    })
    .join(' ');
}

export function messageTokens(m) {
  return estimateTokens(messageText(m));
}

function firstUserLine(m) {
  const t = (m.parts || []).find((p) => p.t === 'text');
  if (!t) return '';
  return t.text.split('\n')[0].slice(0, 100);
}

function summarize(dropped) {
  const userLines = dropped
    .filter((m) => m.role === 'user')
    .map(firstUserLine)
    .filter(Boolean)
    .slice(0, 25)
    .map((l) => `- ${l}`);
  const body = userLines.length ? `\nEarlier user turns:\n${userLines.join('\n')}` : '';
  return `[Baton compaction] ${dropped.length} earlier message(s) omitted to fit the target model's context window; the most recent turns below are verbatim.${body}`;
}

// Keep newest messages verbatim until `budgetTokens`, replacing the older
// prefix with a single synthetic system summary message.
// Returns { messages, compacted }.
export function compact(messages, budgetTokens) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: messages || [], compacted: false };
  }
  const costs = messages.map(messageTokens);
  const total = costs.reduce((a, b) => a + b, 0);
  if (total <= budgetTokens) return { messages, compacted: false };

  const reserve = 800; // headroom for the summary + render scaffolding
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (kept.length && used + costs[i] > budgetTokens - reserve) break;
    kept.unshift(messages[i]);
    used += costs[i];
  }
  const dropped = messages.slice(0, messages.length - kept.length);
  if (dropped.length === 0) return { messages: kept, compacted: false };
  const summaryMsg = { role: 'system', ts: '', parts: [{ t: 'text', text: summarize(dropped) }] };
  return { messages: [summaryMsg, ...kept], compacted: true };
}
