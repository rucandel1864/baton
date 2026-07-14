# Baton 

**Hand off the *exact* conversation between AI coding tools — with one command.**

You're deep in a session with one model. You hit a usage limit, or you just want a
different model for the next step. You switch… and the new model knows *nothing*. You
burn ten minutes re-explaining the goal, the decisions, the current state.

Baton fixes that. It continuously, passively mirrors your conversations to a shared local
store. In **any** new session — a different tool, a different account, a different model —
you type `/baton` and the new model picks up the **full, verbatim conversation** and
continues as if it had been there the whole time.

It's **bidirectional** across **Claude Code**, **Codex**, and **OpenCode** — hand off from
any to any, including between multiple Claude Code accounts. And for everything else,
`baton copy` puts the handoff on your clipboard, so **any** tool with a paste box (other
CLIs, IDE agents, even web chats) can pick it up too.

---

## What "exact context" means (honest version)

Baton places the **entire prior conversation — every user/assistant message, tool call,
and tool result — into the new model's context window**, and the model reads it and
continues. That's *full-transcript replay*.

It does **not** transplant a model's internal state / KV-cache into a different model —
that's physically not a thing any tool can do. Full-transcript replay is the real,
achievable version of "it already knows everything we talked about," and it's what you
actually want.

Two size guards keep the handoff practical:
- If a transcript exceeds the budget (`maxTokens`, default 150k), Baton keeps the most
  recent turns **verbatim** and compacts the oldest turns into a short summary.
- Very long individual tool outputs are truncated (20k chars each) — you keep what the
  models actually said and did, not megabytes of build logs.

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

- a passive **Stop hook** in every Claude Code config dir it finds (`$CLAUDE_CONFIG_DIR`,
  `~/.claude`, and any `~/.claude-*` multi-account dirs) — captures each turn automatically;
- a **`/baton`** slash command in those same config dirs;
- a **Baton skill** in `~/.codex/skills/baton/` — the mechanism the **Codex desktop app**
  supports (custom prompts are deprecated there);
- a **`/baton`** custom prompt in `~/.codex/prompts/` for the Codex **CLI / IDE extension**;
- a **`/baton`** custom command in OpenCode's config dir — with inline shell injection,
  so it's seamless like Claude Code.

Your existing `settings.json` is backed up to `settings.json.baton-bak` before the first
change. Nothing leaves your machine. To remove everything (the store is left intact):

```bash
npx -y github:rucandel1864/baton uninstall
```

---

## Use

Capture is automatic — just keep working. To pick up a conversation in a **new** session:

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
1. Have a conversation in Claude Code.
2. Open Codex (or OpenCode, or another Claude account). Type `/baton`.
3. It already knows everything. Keep going.

---

## Any other tool: `baton copy`

Baton isn't limited to the tools it has adapters for. To hand off to **anything** —
Gemini CLI, Aider, an IDE agent, even ChatGPT or claude.ai in a browser:

```bash
npx -y github:rucandel1864/baton copy
```

That renders the latest conversation for the current folder and puts it on the OS
clipboard (Windows/macOS/Linux). Paste it as the first message of the new session — the
handoff includes its own "you are resuming this conversation" preamble, so the receiving
model knows exactly what to do.

Two more universal options, plus a guide to writing first-class adapters (~100 lines
each), live in **[docs/ADAPTERS.md](docs/ADAPTERS.md)**.

---

## How it works (no daemon)

```
Claude Code turn ends ─▶ Stop hook ─▶ `baton capture`
                                          │  (parses ONLY new bytes via a
                                          │   per-session byte-offset watermark)
                                          ▼
                                 ~/.baton/  (canonical JSON, one file per convo)
                                          ▲
Codex rollouts ────(scanned on demand)────┤
OpenCode SQLite ───(scanned on demand)────┘
                                          │
new session ─▶ /baton ─▶ `baton render` ─▶ full transcript as Markdown ─▶ injected
```

- **Capture** is a passive hook — there is **no background process** to babysit. Claude
  Code already persists transcripts to disk; Baton just mirrors the new lines.
- **Codex** has no hook, so its `~/.codex/sessions/*.jsonl` rollouts are imported on
  demand when you run `/baton` (newest-first, project-matched, mtime-skipped).
- **OpenCode** stores conversations in a SQLite DB (`opencode.db`); Baton reads it on demand
  via Node's built-in `node:sqlite` (Node ≥ 22.5; older Node just skips OpenCode).
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

Rendered handoffs also frame the transcript as a **historical record**: the receiving
model is told not to act on instructions embedded inside old messages or tool outputs
(a basic prompt-injection guard), and tool output is fenced so it can't fake its way
out of its code block.

---

## Scope & limitations (v1)

- First-class: **Claude Code**, **Codex** (app + CLI), and **OpenCode** (`node:sqlite`
  reader needs Node ≥ 22.5). Everything else: `baton copy` / [docs/ADAPTERS.md](docs/ADAPTERS.md).
- Single machine (all endpoints share `~/.baton/`). No cross-machine sync yet.
- The Claude Code transcript format is officially "internal and may change between
  versions." Baton's parser is deliberately tolerant (skips unknown lines, never
  crashes) and isolated to one module, so a format change is a one-file fix.

## CLI reference

```
baton capture [--file <transcript>]     Mirror a transcript (Stop hook uses stdin)
baton render  [--project <dir>] [--arg <list|N>] [--id <id>] [--max-tokens N] [--no-redact]
baton copy    [same options as render]  Render + copy to the OS clipboard (any tool)
baton list    [--project <dir>|--all] [--json]
baton install [--dry-run]
baton uninstall
```

## Contributing

New tool adapters are the most valuable contribution — the canonical format and a
step-by-step checklist are in [docs/ADAPTERS.md](docs/ADAPTERS.md). Run `node --test`
before sending a PR (zero-dependency policy: tests use only `node:test`).

## License

MIT.
