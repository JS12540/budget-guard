# Changelog

All notable changes to Budget Guard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] — 2026-05-22

### Added
- `PreToolUse` hook that estimates token cost per tool call using actual input data
  - `Read`: uses real file size via `fs.statSync()`, respects `offset`/`limit`
  - `Write` / `Edit` / `MultiEdit`: measures content length
  - `Bash`: command text length + output overhead
  - `WebFetch` / `WebSearch` / `Agent` / `mcp__*`: calibrated fixed estimates
- Four progressive warning tiers (advisory → elevated → critical → urgent)
  - Each fires exactly once per session via persistent flags
  - Warnings delivered to Claude via `additionalContext` (non-blocking)
- `SessionStart` hook that initialises or restores session state
  - Handles `startup`, `resume`, `clear`, and `compact` sources correctly
  - Archives previous session to history on fresh start
- `PostCompact` hook that updates token baseline after `/compact`
  - Resets all warning flags so they re-fire naturally from the new baseline
  - Uses Claude Code's reported `tokens_after` for accurate post-compact count
- `/budget-guard:budget` skill — formatted live report with:
  - Progress bar
  - Breakdown by category (file ops, bash, search, MCP, agent, other)
  - Status line with actionable status
  - Context-aware recommendations
  - Last-5-session history
- `/budget-guard:reset` skill — zeros all counters and clears warning flags
- `userConfig` for in-dialog configuration at plugin enable time
- Env var overrides: `CLAUDE_BUDGET_GUARD_LIMIT`, `CLAUDE_BUDGET_GUARD_WARN`, `CLAUDE_BUDGET_GUARD_CRITICAL`
- Session files stored in `${CLAUDE_PLUGIN_DATA}/sessions/<id>.json`
- Automatic 7-day pruning of old session files
- Session history (last 50) in `${CLAUDE_PLUGIN_DATA}/history.json`
- Atomic state writes (pid-unique temp + rename) for concurrent-session safety
- Pure Node.js implementation — works on macOS, Linux, and Windows natively
