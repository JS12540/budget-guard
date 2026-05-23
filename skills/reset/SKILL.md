---
name: reset
description: Reset the session budget counter to zero. Use when the user asks to reset the budget, clear the token counter, or start fresh tracking.
disable-model-invocation: true
allowed-tools: Bash
---

# Budget Guard — Reset Counter

Run the following command to reset the budget counter for this session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/reset-budget.js" "${CLAUDE_SESSION_ID}"
```

Present the output exactly as printed.

After resetting, remind the user:
- The budget guard will start accumulating from zero again.
- All warning flags are cleared — thresholds will fire fresh.
- This does not affect Claude Code's actual context window.
- If context is large, also run `/compact` to actually free context.
