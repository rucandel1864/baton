# Using Baton with any tool

Baton ships first-class integrations for **Claude Code**, **Codex**, **Cursor**, and
**OpenCode** — but the engine underneath is tool-agnostic. Everything is plain commands over a plain
store, so wiring up *anything else* takes a minute.

## Pickup from any tool (no adapter needed)

There are three universal ways to hand a conversation to a tool Baton doesn't know about:

### 1. `baton copy` — works with literally anything

```bash
npx -y github:rucandel1864/baton copy          # or: node ~/.baton/engine/bin/baton.mjs copy
```

Renders the latest conversation for the current folder and puts it on the OS clipboard
(`clip` / `pbcopy` / `wl-copy` / `xclip` / `xsel`). Paste it as the first message of any
new session — another CLI, an IDE agent, even a web chat like ChatGPT or claude.ai.

### 2. Ask the agent to run the command

Any agentic CLI that can execute shell commands can pick up a handoff without any
configuration. In the new session, say:

> Run `node ~/.baton/engine/bin/baton.mjs render` and continue that conversation.

### 3. Add a custom command (if the tool supports them)

Most agentic CLIs have some notion of a user-defined command. Point it at
`baton render`. Example for **Gemini CLI** (`~/.gemini/commands/baton.toml`):

```toml
description = "Continue the latest Baton conversation for this project"
prompt = """
!{node ~/.baton/engine/bin/baton.mjs render --project . --arg "{{args}}"}
"""
```

Now `/baton` works in Gemini CLI too. The same pattern applies to any harness with
shell-executing custom commands.

## Capture from any tool

Capture is the tool-specific half — Baton needs to read the tool's transcript format.
Two options:

### The zero-code way

If the tool logs conversations to files at all, you can often skip writing an adapter:
paste the transcript into any *supported* tool once, or simply start the next leg of the
work from a supported tool. Every session in Claude Code / Codex / OpenCode is captured
automatically, so the chain continues from there.

### Writing a real adapter

An adapter is one small module that converts the tool's native transcript into Baton's
canonical conversation and upserts it into the store. Look at `src/opencode-import.mjs`
(SQLite) or `src/codex-import.mjs` (JSONL) — each is ~100 lines.

The canonical shape (`~/.baton/conversations/<id>.json`):

```jsonc
{
  "id": "mytool:session-id",       // namespaced, stable per conversation
  "source": "mytool",
  "project": "/abs/path/to/project", // used for project-matched pickup
  "model": "model-name",
  "title": "first user line or tool-provided title",
  "created": "ISO-8601", "updated": "ISO-8601",
  "messages": [
    { "role": "user" | "assistant" | "system", "ts": "ISO-8601", "parts": [
      { "t": "text", "text": "..." },
      { "t": "thinking", "text": "..." },
      { "t": "tool_use", "name": "toolName", "input": { } },
      { "t": "tool_result", "name": "toolName", "text": "...", "truncated": false }
    ] }
  ]
}
```

Wire-up checklist:

1. Create `src/mytool-import.mjs` exporting `importRecentMytool(project)`.
   Use a watermark (mtime / row timestamp) so repeat scans are cheap, and call
   `upsertConversation(...)` from `src/store.mjs` with `mode: 'replace'`.
2. Add it to `refresh()` in `src/select.mjs` inside its own try/catch (one broken
   importer must never break pickup).
3. If the tool supports custom commands, add an injection template and wire it in
   `install.mjs` (see `opencode-command/baton.md` for the pattern).
4. Add a test following `test/opencode-import.test.mjs`.

PRs for new adapters are very welcome — that's the whole point of the canonical format.
