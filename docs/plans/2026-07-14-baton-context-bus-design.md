# Baton — Portable Conversation-Context Bus

**Date:** 2026-07-14
**Status:** Approved design, pre-implementation

## Problem

When an AI coding session hits a usage limit (or you want a different model), you switch
account/model/harness and lose the conversation. The new session has zero context, so you
burn time re-explaining the goal, decisions, and state. Memories/summaries are lossy — you
want the **exact conversation** to continue in the new tool.

## Goal

A tool that continuously, passively mirrors the current session's transcript to a shared
local store, so that in **any** new session — Claude Code Account B, GLM/LongCat (which run
inside Claude Code), or the **Codex app/CLI** — a single command injects the **full verbatim
transcript** and the new model continues seamlessly.

Distributable as a GitHub repo. Install once, leave running (a passive hook — no daemon).

## Scope (v1)

- **In:** Claude Code family (Account A ↔ B, GLM, LongCat — all share CC's session format) and
  Codex (app + CLI). Both directions.
- **Out (later):** OpenCode/DeepSeek, cross-machine sync, live streaming daemon, other harnesses.

## What "exact context" means (honest)

The **entire prior conversation text — user/assistant messages, tool calls, and tool results —
is placed into the new model's context window**, and the model reads and continues from it. No
tool can transplant a model's internal state / KV-cache across *different* models — that is not
physically possible. What is achievable and what this delivers is **full-transcript replay**,
which produces the "it already knows everything we discussed" outcome.

## User-facing behavior

- **Capture:** automatic and passive. After every Claude Code turn, a Stop hook mirrors the
  transcript to the store. No commands, no visible latency, no daemon.
- **Pickup:** one command in the new session — `/pickup` (Claude Code slash command; Codex
  custom prompt). Defaults to the **most recent conversation for the current project folder**.
  `/pickup list` shows recent conversations (title + timestamp + source tool) to choose one.
- **Fidelity:** verbatim by default. If the transcript exceeds the target model's context
  budget, the **oldest** turns are compacted into a summary while **recent** turns stay verbatim.

## Architecture

### 1. Canonical store — `~/.baton/`
Shared across accounts on one machine (NOT under either CC config dir, so both A and B read it).

```
~/.baton/
  index.json                 # [{id, project, title, tool, model, updated, path, watermark}]
  conversations/<id>.json    # normalized conversation (one file per conversation)
  config.json                # redaction toggle, token budget defaults, extra source roots
```

Canonical conversation format:
```json
{
  "id": "…", "source": "claude-code|codex", "model": "…",
  "project": "/abs/path", "title": "first user line …",
  "created": "ISO", "updated": "ISO",
  "messages": [
    {"role":"user|assistant|system","text":"…",
     "tool_calls":[{"name":"…","input":…}],
     "tool_results":[{"name":"…","output":"…","truncated":false}],
     "ts":"ISO"}
  ]
}
```

### 2. `baton` CLI (Node, zero dependencies)
The single engine every integration calls.

- `baton capture <transcript_path>` — normalize new lines → upsert conversation + index.
  Incremental via a per-session byte-offset **watermark**; only parses appended lines.
- `baton list [--project <dir>] [--json]` — recent conversations, newest first.
- `baton render [--project <dir>] [--latest | --id <id>] [--max-tokens N] [--no-redact]`
  — emit the selected conversation as verbatim Markdown for injection; compact oldest turns
  only if over budget; apply redaction unless disabled.
- `baton install` / `baton uninstall` — wire/unwire hooks + slash command in every CC config
  dir found (A and B) and drop/remove the Codex prompt.

### 3. Claude Code plugin
- **Stop hook** → `baton capture "$transcript_path"`. Passive, incremental, fast; the hook
  input already provides `transcript_path`.
- **`/pickup` slash command** → runs `baton render --project . [--latest|--id …]` and injects
  its stdout as the prior conversation the model continues from.
- Installed into both `~/.claude` and `~/.claude-b`.

### 4. Codex integration
- `~/.codex/prompts/pickup.md` — a custom prompt (real slash command in Codex CLI **and** app)
  that instructs Codex to run `baton render` and continue from its output.
- Capture *from* Codex: `baton` reads `~/.codex/sessions/*.jsonl` rollouts on demand at pickup,
  normalizing the latest — so Codex → Claude Code handoff also works. No Codex-side daemon.

## Data flow (the magic test)

1. This Account-A session runs; the Stop hook mirrors the transcript to `~/.baton/` each turn.
2. Open a new chat in B / GLM / the Codex app; type `/pickup`.
3. Baton finds the newest conversation for this project folder, renders it verbatim (compacting
   oldest turns only if it won't fit), and the new model reads it and continues.

## Performance requirements (first-class)

The capture hook runs after **every** turn, so speed is a hard requirement, not a nicety:

1. **Zero runtime dependencies, pure Node** — fast process startup, instant `npx`, tiny repo.
2. **Incremental capture** — per-session byte-offset watermark stored in the index; each hook
   run parses only newly appended transcript bytes. O(new turns), never O(whole session).
3. **Normalize once at capture.** `/pickup` only reads canonical JSON + renders; no re-parsing
   of raw harness transcripts at handoff time.
4. **Fast char-based token estimate** (~chars/4 with margin) for the size guard — no heavy
   tokenizer on the hot path.
5. **Append-friendly per-conversation files** so long sessions never rewrite large blobs.
6. Hook does the minimum and exits; never blocks the user-visible turn on anything slow.

## Safety

- Bundles are local under `~/.baton/`. Nothing leaves the machine.
- Optional light redaction of high-confidence secret patterns (API keys/tokens) at capture
  time. Configurable and removable — relevant because the repo is shared publicly.

## Key decision & rejected alternative

**Chosen:** hook-on-capture + on-demand-read + one slash command, **no daemon**.
**Rejected:** a persistent `baton watch` daemon tailing every session dir — more "live," but a
process to babysit and unnecessary, since Claude Code persists transcripts live and Codex can
be read on demand. Deferred; can be added for cross-machine/live streaming later.

## Testing

- Normalizer unit tests: CC JSONL → canonical, Codex rollout → canonical (fixture transcripts).
- Round-trip test: capture a real session → render → assert key content survives.
- Size-guard test: oversized transcript → compacted output fits under budget, recent turns
  verbatim.
- Incremental-capture test: appending lines advances the watermark and only new turns parse.
- Manual E2E: Account A → B, and Account A → Codex.

## Deliverable

GitHub repo. `npx baton install` (or `node install.mjs`) sets up hooks + slash command in both
CC config dirs and the Codex prompt. The only always-on component is a passive hook.
