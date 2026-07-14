# Baton 🪃

**Hand off the *exact* conversation between AI coding tools — with one command.**

You're deep in a session with one model. You hit a usage limit, or you just want a
different model for the next step. You switch… and the new model knows *nothing*. You
burn ten minutes re-explaining the goal, the decisions, the current state.

Baton fixes that. It continuously, passively mirrors your conversation to a shared local
store. In **any** new session — a different Claude Code account, GLM/LongCat running
inside Claude Code, or the **Codex** app/CLI — you type `/baton` and the new model picks
up the **full, verbatim conversation** and continues as if it had been there the whole
time.

It's **bidirectional**: Claude Code → Codex, Codex → Claude Code, account A → account B,
and back. Whatever tool you land in, `/baton` pulls the latest conversation for that
project regardless of which tool produced it.

---

## What "exact context" means (honest version)

Baton places the **entire prior conversation — every user/assistant message, tool call,
and tool result — into the new model's context window**, and the model reads it and
continues. That's *full-transcript replay*.

It does **not** transplant a model's internal state / KV-cache into a different model —
that's physically not a thing any tool can do. Full-transcript replay is the real,
achievable version of "it already knows everything we talked about," and it's what you
actually want.

If a transcript is bigger than the target model's context window, Baton keeps the most
recent turns **verbatim** and compacts the oldest turns into a short summary.

---

## Install

Requires **Node ≥ 18**. Zero runtime dependencies. One command:

```bash
npx -y github:rucandel1864/baton install
```

That's it — no clone needed. Install copies a stable engine into `~/.baton/engine/`
and wires everything to point at it, so it keeps working even after the npx cache is
cleaned. Re-run any time to update.

<details>
<summary>Or from a clone</summary>

```bash
git clone https://github.com/rucandel1864/baton
cd baton
node install.mjs
```
</details>

This wires up, idempotently:

- a passive **Stop hook** in every Claude Code config dir it finds (`~/.claude`,
  `~/.claude-b`, `$CLAUDE_CONFIG_DIR`) — captures each turn automatically;
- a **`/baton`** slash command in those same config dirs;
- a **Baton skill** in `~/.codex/skills/baton/` — the mechanism the **Codex desktop app**
  supports (custom prompts are deprecated there);
- a **`/baton`** custom prompt in `~/.codex/prompts/` for the Codex **CLI / IDE extension**.

Your existing `settings.json` is backed up to `settings.json.baton-bak` before the first
change. Nothing leaves your machine. To remove everything (the store is left intact):

```bash
node uninstall.mjs
```

---

## Use

Capture is automatic — just keep working in Claude Code. To pick up a conversation in a
**new** session (any tool):

| Command | What it does |
|---|---|
| `/baton` | Load the **most recent** conversation for the current project folder |
| `/baton list` | Show recent conversations (title · time · which tool) to choose from |
| `/baton 3` | Load conversation **#3** from that list |

**In the Codex desktop app**, pickup is a **skill**, not a slash command (Codex deprecated
custom prompts in the app). Fully quit and reopen Codex once after installing, then in a new
conversation just say **"load the baton handoff"** (or "continue where we left off") — Codex
runs the Baton skill and continues from the prior conversation. In the Codex **CLI / IDE
extension**, `/baton` works as a custom prompt.

### The magic test
1. Have a conversation in Claude Code (Account A).
2. Open Codex (or Account B, or GLM). Type `/baton`.
3. It already knows everything. Keep going.

---

## How it works (no daemon)

```
Claude Code turn ends ─▶ Stop hook ─▶ `baton capture`
                                          │  (parses ONLY new bytes via a
                                          │   per-session byte-offset watermark)
                                          ▼
                                 ~/.baton/  (canonical JSON, one file per convo)
                                          ▲
Codex rollouts ──(scanned on demand)──────┘
                                          │
new session ─▶ /baton ─▶ `baton render` ─▶ full transcript as Markdown ─▶ injected
```

- **Capture** is a passive hook — there is **no background process** to babysit. Claude
  Code already persists transcripts to disk; Baton just mirrors the new lines.
- **Codex** has no hook, so its `~/.codex/sessions/*.jsonl` rollouts are imported on
  demand when you run `/baton` (newest-first, project-matched, mtime-skipped).
- Everything normalizes to one tool-neutral format, so any endpoint can read any other's
  conversations.

### Speed
Built to stay off the critical path: zero dependencies (fast startup), incremental
capture (only new bytes are parsed), normalize-once (pickup only reads + renders), and a
fast char-based token estimate instead of a heavy tokenizer. The hook does the minimum
and exits; a failure is swallowed so a turn is never blocked.

---

## Configuration — `~/.baton/config.json`

```json
{
  "redact": true,          // mask high-confidence secrets (API keys, tokens, JWTs) in output
  "maxTokens": 150000,     // compact older turns if a transcript exceeds this
  "includeThinking": false // include assistant "thinking" blocks (bigger, usually unneeded)
}
```

CLI overrides: `baton render --no-redact`, `baton render --max-tokens 400000`.

---

## Security

Bundles live locally under `~/.baton/`. Redaction of high-confidence secret patterns is
**on by default** for rendered output. This is best-effort — if a transcript contains
sensitive data you don't want copied into another tool, review before handing off, or
prune `~/.baton/`.

---

## Scope & limitations (v1)

- Supported: **Claude Code** (all accounts / GLM / LongCat) and **Codex** (app + CLI).
- Single machine (all endpoints share `~/.baton/`). No cross-machine sync yet.
- The Claude Code transcript format is officially "internal and may change between
  versions." Baton's parser is deliberately tolerant (skips unknown lines, never
  crashes) and isolated to one module, so a format change is a one-file fix.

## CLI reference

```
baton capture [--file <transcript>]     Mirror a transcript (Stop hook uses stdin)
baton render  [--project <dir>] [--arg <list|N>] [--id <id>] [--max-tokens N] [--no-redact]
baton list    [--project <dir>|--all] [--json]
baton install [--dry-run]
baton uninstall
```

## License

MIT.
