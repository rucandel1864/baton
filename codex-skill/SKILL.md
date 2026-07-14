---
name: baton
description: Use whenever the user wants to continue, resume, or pick up a prior conversation that was handed off from another model, account, or session via Baton — e.g. they type "/baton", say "baton", "continue where we left off", "load the handoff", "pick up the previous conversation", "I ran out of usage in the other session", or otherwise expect you to already know context from before this session started. Loads the EXACT prior conversation so you can continue seamlessly.
---

# Baton — continue a handed-off conversation

The user is resuming a conversation that Baton captured in another tool, account, or session (e.g. they hit a usage limit elsewhere and switched to you). Your job is to load that exact conversation and continue it as if you had been there all along.

## Steps

1. Run this command — it prints the full prior conversation for the current project:

   ```bash
   node "__BATON_BIN__" render --project "$(pwd)"
   ```

   - To choose a specific conversation instead of the latest, first run it with `--arg list` to see the options, then re-run with `--arg <number>`.
   - If it prints that no conversation was found, tell the user and suggest `--arg list`.

2. Treat the command's **complete stdout as the EXACT prior conversation you are continuing.** Read all of it, and follow the guidance printed at the top of that output.

3. For your **first reply** after loading: give only a short, one-line confirmation that you are caught up (name the topic so the user knows the right conversation loaded), then wait for the user. Do **not** greet, re-introduce yourself, summarize the conversation, or repeat/re-suggest any install / setup / restart / next-step instructions that appear in the transcript — those already happened. Treat the prior assistant turns as your own work and continue from where it left off once the user responds.
