# Baton — continue a handed-off conversation

Load the EXACT prior conversation for this project (captured by Baton from Claude Code, Codex, OpenCode, Cursor, or another account) and continue it seamlessly.

1. Run this in the terminal — it prints the full prior conversation:

   ```bash
   node "__BATON_BIN__" render --project .
   ```

   - If the user typed something after `/baton`: `list` → run with `--arg list` and show the options; a number → run with `--arg <number>` to load that conversation.
   - If it prints that no conversation was found, say so and suggest `/baton list`.

2. Treat the command's **complete stdout as the EXACT prior conversation you are continuing** — the user expects you to already know everything in it. Read all of it and follow the guidance printed at the top of that output.

3. First reply after loading: one short line confirming you're caught up (name the topic), then wait for the user. Do NOT greet, summarize, or repeat any install/setup/restart steps that appear in the transcript — those already happened. Treat prior assistant turns as your own work.
