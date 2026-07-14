Continue a prior conversation handed off via Baton (from Claude Code, another account, or a previous Codex session).

Run this command and treat its **complete stdout** as the EXACT prior conversation you are continuing — the user expects you to already know everything in it. Read it fully, then continue seamlessly: do not greet, re-introduce, or re-ask anything already covered. Treat prior assistant turns as your own work. If the output says no conversation was found, tell me and suggest running it with `list` instead.

```bash
node "__BATON_BIN__" render --project "$(pwd)" --arg "$ARGUMENTS"
```
