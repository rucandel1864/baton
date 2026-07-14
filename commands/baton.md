---
name: baton
description: Load a prior conversation into this session — this project's latest, or one handed off from another model/account. Usage: /baton · /baton list · /baton <number>
allowed-tools: Bash(node:*)
---

The block below is the EXACT prior conversation you are continuing, provided by Baton. Read it fully and continue seamlessly — the user expects you to already know everything in it, so do not greet, re-introduce yourself, or re-ask anything already covered. Treat the prior assistant turns as your own. If the block says no conversation was found, tell the user and suggest `/baton list`.

!`node "__BATON_BIN__" render --project "." --arg "$ARGUMENTS"`
