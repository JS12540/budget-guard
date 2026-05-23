---
name: budget
description: Show a real-time session budget report — token usage by category, progress bar, status, recommendations, and session history. Use when the user asks about budget, token usage, context usage, or how much budget is left.
disable-model-invocation: false
allowed-tools: Bash
---

# Budget Guard — Session Report

Run the following command to generate the live budget report:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/budget-report.js" "${CLAUDE_SESSION_ID}"
```

Present the output **exactly as printed** — do not rephrase, summarise, or omit any section. The report is already formatted for the user.

If the command fails or the output is empty, say:
"Budget Guard could not read the session state. The plugin may not be fully initialised — try running a tool first, then retry /budget-guard:budget."
