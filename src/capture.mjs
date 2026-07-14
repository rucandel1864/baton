// Capture the current Claude Code transcript into the store.
// Called by the Stop hook (stdin JSON) or with an explicit file (tests/manual).
// MUST be robust: any failure returns quietly so a turn is never broken.
import fs from 'node:fs';
import { parseCcTranscript } from './normalize-cc.mjs';
import { readConversation, upsertConversation, readConfig } from './store.mjs';

export function captureFromHook(stdinText) {
  let input;
  try {
    input = JSON.parse(stdinText);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const tp = input && input.transcript_path;
  if (!tp) return { ok: false, reason: 'no-transcript-path' };
  return captureFile(tp, input.session_id);
}

export function captureFile(transcriptPath, sessionIdHint) {
  const cfg = readConfig();
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return { ok: false, reason: 'no-file' };
  }

  let id = sessionIdHint ? 'cc:' + sessionIdHint : null;
  let watermark = 0;
  let rewound = false;
  if (id) {
    const ex = readConversation(id);
    if (ex) watermark = ex.watermark || 0;
  }
  if (stat.size < watermark) {
    // Transcript shrank (rotated/rewritten under the same session id): the old
    // watermark is meaningless. Re-parse from the start and REPLACE the stored
    // messages, otherwise capture would silently stall forever.
    watermark = 0;
    rewound = true;
  }
  if (id && stat.size <= watermark) return { ok: true, reason: 'no-change', id };

  // Read only the new region [watermark, size). Watermark always lands after a
  // newline, so parsing the partial buffer from offset 0 is safe.
  const len = stat.size - watermark;
  if (len <= 0) return { ok: true, reason: 'no-change', id };
  const part = Buffer.alloc(len);
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, part, 0, len, watermark);
  } catch {
    return { ok: false, reason: 'read-failed' };
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }

  const parsed = parseCcTranscript(part, 0, { includeThinking: cfg.includeThinking });
  const absOffset = watermark + parsed.newOffset;

  if (!id) {
    const sid = parsed.meta.sessionId;
    if (!sid) return { ok: false, reason: 'no-session-id' };
    id = 'cc:' + sid;
  }
  if (parsed.messages.length === 0 && absOffset <= watermark) {
    return { ok: true, reason: 'no-new-lines', id };
  }

  upsertConversation({
    id,
    source: 'claude-code',
    sourcePath: transcriptPath,
    meta: parsed.meta,
    messages: parsed.messages,
    newOffset: absOffset,
    mode: rewound ? 'replace' : 'append',
  });
  return { ok: true, id, added: parsed.messages.length };
}
