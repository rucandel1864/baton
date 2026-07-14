# Baton Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a zero-dependency Node tool that continuously mirrors Claude Code session transcripts to a shared local store and injects a prior conversation — verbatim — into a new Claude Code or Codex session via a single `/baton` command.

**Architecture:** A `baton` CLI is the only engine. A passive Claude Code **Stop hook** calls `baton capture` after each turn (incremental, byte-offset watermark). A `/baton` slash command (CC) and a `baton` custom prompt (Codex) call `baton render`, whose stdout is injected as the prior conversation. Codex sessions are imported on demand by scanning the newest rollout files. Everything normalizes to one canonical JSON per conversation under `~/.baton/`.

**Tech Stack:** Node ≥ 18 (built-in `node:test`, `node:assert`, `fs`, `path`, `os`, `crypto`), ESM `.mjs`, **zero runtime dependencies**. Targets Windows first (paths, both `~/.claude` and `~/.claude-b`).

---

## Ground-truth reference (verified on this machine 2026-07-14 — do not re-guess)

### Claude Code transcript line schema
Path: `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl` (also `~/.claude-b/...`).
`<sanitized-cwd>` = the cwd with `:`, `\`, `/` each replaced by `-` (e.g. `C:\Users\sneak\OneDrive\Desktop\investing` → `C--Users-sneak-OneDrive-Desktop-investing`). `subagents/` subfolder is separate — **ignore it**.

Line types seen: `last-prompt`, `mode`, `permission-mode`, `attachment`, `file-history-snapshot`, `summary`, `user`, `assistant`. Only `user`/`assistant` matter. Shape of a real message line:
```json
{"type":"user","message":{"role":"user","content":"..."|[{...parts}]},
 "isMeta":false,"uuid":"...","parentUuid":"...","timestamp":"ISO",
 "cwd":"C:\\Users\\...","sessionId":"...","gitBranch":"...","version":"..."}
```
Content parts: `{type:"text",text}`, `{type:"thinking",thinking}`, `{type:"tool_use",id,name,input}`, `{type:"tool_result",tool_use_id,content}`. `content` may also be a bare string (user text).
**Filter out:** any line whose `type` ∉ {user,assistant}; any message with `isMeta:true`; any user text that is a slash-command wrapper (`<command-name>`, `<command-message>`, `<command-args>`, `<local-command-stdout>`, `<local-command-caveat>`) — these are UI noise, not conversation.

### Codex rollout line schema
Path: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl` (+ `~/.codex/archived_sessions/`). Every line: `{timestamp, type, payload}`.
- `type:"session_meta"` → `payload.{id, parent_thread_id, timestamp, cwd?, instructions?}` (first line).
- `type:"turn_context"` → `payload.{turn_id, cwd, workspace_roots, ...}` (authoritative cwd).
- `type:"response_item"` → `payload.type` ∈ {`message`,`reasoning`,`custom_tool_call`,`custom_tool_call_output`}:
  - `message`: `{role:"user"|"assistant"|"developer", content:[{type:"input_text"|"output_text", text}]}`. **Skip role `developer`** and any user text starting with `<environment_context>` or `<permissions instructions>`.
  - `reasoning`: `{encrypted_content}` → **skip** (opaque).
  - `custom_tool_call`: `{name:"exec", input, call_id, status}` → tool call.
  - `custom_tool_call_output`: `{call_id, output:[{type:"input_text",text}]}` → tool result.
- `type:"event_msg"` → `payload.type` ∈ {task_started, user_message, agent_message, token_count} → **skip all** (messages are duplicated in `response_item`).

### Claude Code Stop hook + slash command (VERIFIED against real installed plugins 2026-07-14)
- Stop hook config in `settings.json`. **Exact shape (nested — matcher omitted for Stop):**
  ```json
  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "node \"<abs>/bin/baton.mjs\" capture" } ] } ] }
  ```
  (This nested `{hooks:[{type,command}]}` form is what installed plugins actually use here; a flat `{type,command}` array element is NOT the accepted shape on this version.)
- Stop hook receives JSON on **stdin** with confirmed fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name:"Stop"`, `last_assistant_message`, `effort.level`. Exit 0 always; plain stdout is treated as added context (so our capture must print **nothing** on success).
- Slash command = markdown in `~/.claude/commands/<name>.md` with frontmatter `name`, `description`, `allowed-tools`. **Inline exec confirmed:** `` !`shell command` `` (at line start / after whitespace) runs at invocation and substitutes stdout into the prompt (not a tool the model runs). `allowed-tools` frontmatter is required for exec (e.g. `Bash(node:*)`). Interpolation: `$ARGUMENTS`, `$0/$1`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`. Global kill-switch: `disableSkillShellExecution`.
- **Name the command `/baton`** — `/pickup` and `/resume` are already taken on this machine.

### Symmetry — Baton is fully bidirectional (do NOT build one-way)
Baton is a shared bus, not a CC→Codex pipe. **Every** supported endpoint both *captures* and *injects*:
- Capture: Claude Code (Stop hook, Task 9) **and** Codex (rollout import, Task 8).
- Inject: Claude Code (`/baton` slash command, Task 10) **and** Codex (`/baton` custom prompt, Task 10).
So all directions must work and are covered by the same store + `select`: A→B, B→A, CC→Codex, **Codex→CC**, Codex→Codex. `select.pick()` chooses the newest matching conversation for the project *regardless of which tool produced it*. Every test in Tasks 7/8/10/12 must include at least one cross-tool case (a Codex-sourced conversation rendered for a CC pickup, and vice-versa).

---

## Repo layout

```
baton/
  package.json              # type:module, bin, "test":"node --test", no deps
  bin/baton.mjs             # CLI entry + arg dispatch
  src/
    paths.mjs               # home, ~/.baton, CC config roots, codex dirs, cwd<->sanitized, path eq
    store.mjs               # index.json + config.json + conversations/<id>.json read/write
    normalize-cc.mjs        # CC JSONL (from byte offset) -> {messages, meta, newOffset}
    normalize-codex.mjs     # Codex rollout -> {messages, meta}
    capture.mjs             # stdin/arg -> detect source -> normalize -> upsert store
    codex-import.mjs        # scan newest codex rollouts matching a project -> upsert
    select.mjs              # list / latest / by-id / by-index over merged store
    tokens.mjs              # estimateTokens(str); compact(messages,budget)
    redact.mjs              # redactSecrets(str) high-confidence patterns
    render.mjs              # select -> markdown (+ compaction + redaction)
  commands/baton.md         # CC slash-command template (paths filled at install)
  prompts/baton.md          # Codex prompt template
  install.mjs               # wire hook+command into CC config dirs; drop codex prompt
  uninstall.mjs
  test/
    fixtures/cc-sample.jsonl
    fixtures/codex-sample.jsonl
    *.test.mjs
  README.md
```

## Canonical conversation format (`~/.baton/conversations/<id>.json`)
```json
{
  "id": "cc:<session-uuid>" | "codex:<rollout-uuid>",
  "source": "claude-code" | "codex",
  "sourcePath": "<abs path to transcript>",
  "project": "<abs cwd, normalized>",
  "model": "<if known>",
  "title": "<first real user line, trimmed to 80 chars>",
  "created": "ISO", "updated": "ISO",
  "watermark": <bytes consumed>,          // CC only, for incremental capture
  "messages": [
    {"role":"user"|"assistant","ts":"ISO",
     "parts":[
       {"t":"text","text":"..."},
       {"t":"tool_use","name":"Bash","input":{...}},
       {"t":"tool_result","name":"Bash","text":"...","truncated":false}
     ]}
  ]
}
```
`~/.baton/index.json`: `[{id, source, project, title, updated, path}]` (path = conversation file). `~/.baton/config.json`: `{redact:true, maxTokens:150000, includeThinking:false, ccRoots:[...], codexHome:"..."}`.

---

## Tasks

### Task 0: Scaffold + CI-free test harness
**Files:** Create `package.json`, `bin/baton.mjs` (stub), `test/smoke.test.mjs`.

**Step 1 — package.json:**
```json
{
  "name": "baton-context-bus",
  "version": "0.1.0",
  "type": "module",
  "bin": { "baton": "bin/baton.mjs" },
  "scripts": { "test": "node --test" },
  "engines": { "node": ">=18" }
}
```
**Step 2 — failing smoke test** `test/smoke.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from '../src/tokens.mjs';
test('tokens module loads', () => { assert.equal(typeof estimateTokens, 'function'); });
```
**Step 3:** Run `node --test` → FAIL (module missing). **Step 4:** create `src/tokens.mjs` (Task 5 gives real impl; stub now). Re-run → PASS. **Step 5:** commit `chore: scaffold baton package`.

### Task 1: `paths.mjs` — path math & discovery
**Files:** Create `src/paths.mjs`, `test/paths.test.mjs`.

Functions:
- `home()` → `os.homedir()`.
- `batonDir()` → `env.BATON_DIR || join(home(), '.baton')`.
- `sanitizeCwd(cwd)` → replace `/[:\\/]/g` with `-` (matches CC dir naming). Test: `C:\Users\sneak\OneDrive\Desktop\investing` → `C--Users-sneak-OneDrive-Desktop-investing`.
- `samePath(a,b)` → normalize (resolve, lowercase on win32, strip trailing sep) and compare. Test win32 case-insensitive + slash-insensitive equality.
- `discoverCcRoots()` → existing dirs among `[env.CLAUDE_CONFIG_DIR, ~/.claude, ~/.claude-b]` that contain a `projects/` or `settings.json`. Dedup.
- `codexHome()` → `env.CODEX_HOME || join(home(), '.codex')`.

**TDD:** write `test/paths.test.mjs` asserting `sanitizeCwd` and `samePath` behavior (pure, no fs). Red → implement → green → commit.

### Task 2: `normalize-cc.mjs` — the load-bearing parser
**Files:** Create `src/normalize-cc.mjs`, `test/fixtures/cc-sample.jsonl`, `test/normalize-cc.test.mjs`.

**Step 1 — build the fixture** from a real transcript (sanitised), containing: a noise `attachment` line, a `mode` line, an `isMeta:true` user line, a `<command-name>` user line, one real string-content user line, one assistant line with a `text` + `thinking` + `tool_use` array, one user line with a `tool_result`. Keep it ~10 lines.

**Step 2 — failing test:**
```js
import { parseCcTranscript } from '../src/normalize-cc.mjs';
// read fixture bytes
const { messages, meta } = parseCcTranscript(buf, 0);
// asserts:
// - noise/meta/command lines dropped
// - real user text present
// - assistant message has parts: text + tool_use (thinking dropped by default)
// - tool_result captured as a tool_result part
// - meta.project === cwd from a line, meta.sessionId set, meta.title === first real user line
// - returns newOffset === buf.length
```
**Step 3 — implement** `parseCcTranscript(buffer, fromOffset, {includeThinking=false}={})`:
- Slice `buffer` from `fromOffset`; split on `\n`; **track byte length consumed up to the last complete line** (ignore a trailing partial line so watermark never splits a JSON object); return `newOffset = fromOffset + consumedBytes`.
- For each parsed line: keep `type` user/assistant; skip `isMeta`; get `message.content`. If string → single text part (skip if it matches the command/caveat wrappers regex). If array → map parts: text→`{t:'text',text}`, tool_use→`{t:'tool_use',name,input}`, tool_result→`{t:'tool_result',name:'',text:stringifyResult(content)}`, thinking→include only if `includeThinking`.
- Drop messages that end up with zero parts.
- `meta`: from first qualifying line capture `project=cwd`, `sessionId`; `title` = first user text part trimmed to 80 chars; `model` if a `message.model` field exists on assistant lines.
- `stringifyResult(content)`: if array, join text parts / JSON-stringify blocks; if string, as-is. Cap each tool_result to e.g. 20k chars with a `…[truncated]` marker + set `truncated:true` (keeps store bounded; render can note it).

**Step 4:** green. **Step 5:** commit `feat: CC transcript normalizer with byte-offset watermark`.

### Task 3: `normalize-codex.mjs`
**Files:** Create `src/normalize-codex.mjs`, `test/fixtures/codex-sample.jsonl`, `test/normalize-codex.test.mjs`.

Fixture (~10 lines): `session_meta`, `turn_context` (with cwd), a `developer` message (must be skipped), an `<environment_context>` user message (skipped), a real user `message`, an `event_msg` (skipped), an assistant `message`, a `custom_tool_call`, a `custom_tool_call_output`, a `reasoning` (skipped).

`parseCodexRollout(buffer)` → `{messages, meta}`:
- meta: `id` from session_meta, `project` = first `turn_context.cwd` (fallback session_meta.cwd), `created` from session_meta.timestamp, `title` = first real user line.
- messages: only `response_item` of type message (role user/assistant, skip developer + env/permissions wrappers), custom_tool_call → assistant `tool_use` part `{name, input}`, custom_tool_call_output → a `tool_result` part attached to the preceding assistant message (or its own user-role carrier). Skip reasoning + event_msg.
- Same 20k truncation on tool outputs.

TDD red→green→commit `feat: Codex rollout normalizer`.

### Task 4: `store.mjs`
**Files:** Create `src/store.mjs`, `test/store.test.mjs` (use a temp `BATON_DIR`).

- `ensureStore()` — mkdir `conversations/`; create `index.json`/`config.json` with defaults if absent.
- `readIndex()` / `writeIndexEntry(entry)` (upsert by id; keep sorted by `updated` desc) / `readConfig()`.
- `readConversation(id)` / `writeConversation(conv)` — atomic write (write tmp + rename).
- `upsertFromCapture({source, sourcePath, meta, messages, newOffset})` — merge: if conv exists, **append** new messages and set `watermark=newOffset`, `updated=now`; else create. Update index entry.

TDD with a temp dir (set `process.env.BATON_DIR`). Assert append-not-duplicate on second call. Commit.

### Task 5: `tokens.mjs` — fast estimate + compaction
- `estimateTokens(str)` → `Math.ceil(str.length / 4)`.
- `compact(messages, budgetTokens)` → keep newest messages verbatim until budget; replace the older prefix with one synthetic system message: `{role:'system',parts:[{t:'text',text:'[Earlier N messages summarized: <bullet recap of user asks + assistant decisions>]'}]}`. v1 recap = deterministic: list the earliest user texts (first line each) + count. Return `{messages, compacted:true|false}`.

TDD: oversized input compacts under budget, newest verbatim, small input untouched. Commit.

### Task 6: `redact.mjs`
- `redactSecrets(str)` → replace high-confidence patterns with `«redacted:<kind>»`: `sk-…`, `sk-ant-…`, AWS `AKIA[0-9A-Z]{16}`, `ghp_…`, `xox[baprs]-…`, generic `(api[_-]?key|secret|token|password)"?\s*[:=]\s*"?[A-Za-z0-9_\-]{16,}`, JWT `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`. Idempotent.

TDD: each pattern redacted; ordinary prose untouched. Commit.

### Task 7: `select.mjs`
- `refresh(project)` → call `codex-import` (Task 8) to pull newest matching Codex rollouts into the store, then `readIndex()`.
- `list({project})` → index filtered by `samePath(entry.project, project)` (or all if no project), newest first, each `{n, id, source, title, updated}`.
- `pick({project, id, index})` → resolve to one conversation id: explicit `id` wins; else `index` (1-based into filtered list); else newest in project; else newest overall. Return `readConversation(id)` or null.

TDD with seeded temp store. Commit.

### Task 8: `codex-import.mjs`
- `importRecentCodex(project, {limit=25})`: enumerate `codexHome()/sessions/**/rollout-*.jsonl` + `archived_sessions/`, sort by filename (ISO in name) desc, take newest `limit`, and for each not already imported at its mtime, `parseCodexRollout` → if `samePath(meta.project, project)` upsert to store (id `codex:<uuid>`, watermark=mtimeMs). Skip files whose stored mtime is unchanged. No stat on skipped-by-recency files beyond the newest `limit`.

TDD: point `CODEX_HOME` at a temp dir with one fixture rollout under `sessions/2026/07/14/`; assert it imports and matches project. Commit.

### Task 9: `capture.mjs` + Stop-hook path
- `captureFromHook()` — read stdin fully; `JSON.parse`; get `transcript_path` (+ `cwd`,`session_id`). If missing/parse fails → exit 0 silently (never break a turn). Read the transcript file; look up existing conv by `cc:<session_id>` to get `watermark` (default 0); `parseCcTranscript(buf, watermark)`; `upsertFromCapture`. Wrap everything in try/catch → always exit 0. Keep it <~50ms typical by reading only from `watermark`.
- CLI: `baton capture` (reads stdin). Also `baton capture --file <path>` for tests.

**Perf guard:** open file, `fs.statSync` size; if `size <= watermark` do nothing. Read via `fs.readSync` from offset into a buffer (avoid loading whole file when watermark>0). 

TDD: feed a fake hook JSON via stdin in a child process pointing at the CC fixture; assert store updated; second run with appended bytes appends only new messages. Commit.

### Task 10: `render.mjs` + CLI + templates
- `render({project, id, index, maxTokens, redact})` → `pick(...)`; if null → print a friendly `No Baton conversation found for <project>. Start one in Claude Code, or run \`baton list\`.` to stdout and exit 0. Else build Markdown:
  ```
  # ⟵ Continuing a prior conversation (via Baton)
  Source: <source> · Project: <project> · Updated: <updated>
  You are picking up this exact conversation. Read it fully; do not greet or re-ask what's already answered.
  ---
  ## User / ## Assistant blocks, in order; tool_use rendered as
  `↳ tool: <name>(<compact input>)` and tool_result as fenced, truncated-noted.
  ```
  Apply `compact(messages, maxTokens)` first, then `redactSecrets` over the final string if `redact`.
- CLI dispatch in `bin/baton.mjs`: `capture|list|render|install|uninstall`, minimal hand-rolled arg parse (`--project`, `--id`, `--index`, `--max-tokens`, `--no-redact`, `--json`).
- `commands/baton.md` template (installed with `__BATON_BIN__` replaced by the absolute path):
  ```markdown
  ---
  name: baton
  description: Load a prior conversation (this project's latest, or from another model/account) into this session. Usage: /baton [list|<index>]
  allowed-tools: Bash(node:*)
  ---
  The block below is the EXACT prior conversation you are continuing. Read it fully and continue seamlessly — the user expects you to already know everything in it. Do not summarize it back unless asked.

  !`node "__BATON_BIN__" render --project "." --index "$ARGUMENTS"`
  ```
  (If `$ARGUMENTS` is empty, `render` treats missing `--index` as “latest”.)
- `prompts/baton.md` template for Codex (`~/.codex/prompts/baton.md`):
  ```markdown
  Run this and treat its full stdout as the EXACT prior conversation you are continuing (the user expects you to already know everything in it), then continue — do not re-ask answered questions:

  `node "__BATON_BIN__" render --project "$(pwd)" --index "$1"`
  ```

TDD: `render` over a seeded conversation returns markdown containing the user text and a tool line, under budget, secrets redacted. Commit.

### Task 11: `install.mjs` / `uninstall.mjs`
- `install`: resolve absolute `bin/baton.mjs`. For each `discoverCcRoots()`:
  - Read/parse `settings.json` (create `{}` if absent). Ensure `hooks.Stop` array contains our entry `{hooks:[{type:"command", command:'node "<abs>" capture'}]}` (nested form, no `matcher` — verified shape); **idempotent** (skip if any existing Stop entry's command already contains `baton.mjs capture`).
  - Write `commands/baton.md` from template with `__BATON_BIN__` → abs path.
  - Back up `settings.json` to `settings.json.baton-bak` once before first modify.
- Drop `prompts/baton.md` into `codexHome()/prompts/` (mkdir if needed) with `__BATON_BIN__` filled.
- Print a summary of what was wired and where.
- `uninstall`: remove our Stop hook entry, delete `commands/baton.md` and `prompts/baton.md`. Leave the store intact.

TDD: point a temp dir as a fake CC root (via a `roots` param), run install twice, assert the hook exists exactly once and command file written; run uninstall, assert removed. Commit.

### Task 12: End-to-end + docs
- E2E test: synthesize a CC transcript in a temp `projects/<sanitized>/<uuid>.jsonl`; run `capture` (hook stdin) → `render --project <cwd>`; assert the rendered markdown reproduces the conversation. Add a Codex E2E with a temp `CODEX_HOME`.
- `README.md`: what it is, the honest "exact = full transcript replay, not KV-cache" note, `install`/`uninstall`, `/baton` + `/baton list` + `/baton <n>` usage in CC and Codex, config knobs (`redact`, `maxTokens`, `includeThinking`), security note, "no daemon" footprint.
- Manual verification checklist (run by the human): A→B pickup, A→Codex pickup, Codex→A pickup.
- Commit `docs: README + e2e`.

---

## Risks / notes for the executor
- **CC JSONL is officially "internal, may change between versions."** Mitigate: the CC parser lives in ONE module (`normalize-cc.mjs`); it must **skip unknown line types and never throw** (a bad line is dropped, not fatal). If a future CC release breaks it, only that module changes. Documented public fallback if parsing ever fails wholesale: `/export` or `claude -p --output-format json` (not passive, so not used in v1). Codex rollout format is likewise treated as tolerant/opaque.
- **Inline-exec confirmed available**; but keep the fallback in mind — if a user has `disableSkillShellExecution:true`, `/baton` can't inline-exec, so the command body should also contain a one-line human-readable instruction to run `baton render` manually.
- **Never block a turn:** the Stop hook must `try/catch` everything and exit 0. Slow/broken capture must be invisible.
- **Windows paths:** compare case-insensitively; the CC `cwd` uses backslashes, the sanitized dir uses dashes — always derive `project` from message `cwd`, not by un-sanitizing the dir name.
- **Idempotency everywhere:** re-install must not duplicate hooks; re-capture must not duplicate messages (watermark) ; codex import must not re-parse unchanged files (mtime).
- **YAGNI:** no daemon, no cross-machine sync, no live streaming, no OpenCode adapter in v1.
