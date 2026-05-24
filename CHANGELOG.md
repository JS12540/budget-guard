# Changelog

All notable changes to Budget Guard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.2] — 2026-05-24

### Added
- **Self-registering hooks** — `SessionStart` now automatically writes all hook paths into `~/.claude/settings.json` on first run using `CLAUDE_PLUGIN_ROOT` (set by Claude Code at runtime). This bypasses a known Claude Code bug where plugin-registered `PreToolUse` and `PostToolUse` hooks do not fire during tool calls. Works for every user without any hardcoded paths — each user's correct cache path is detected automatically
- If hooks were updated, the session context message notifies the user to restart once: `[Hooks registered — restart Claude Code once to activate full tracking.]`
- Old budget-guard hook entries are cleaned from `settings.json` before writing new ones, so plugin updates always leave a single clean set of hooks

### Changed
- Budget report now shows all 10 token categories every time regardless of whether they are zero — previously zero-value categories were hidden which made the report look incomplete

### Fixed
- Plugin hooks not firing for `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop` events due to known Claude Code bug with plugin-registered hooks — resolved by auto-registering hooks in `settings.json` via the always-working `SessionStart` hook

---

## [1.0.1] — 2026-05-23

### Added

- **Full session token tracking** — Budget Guard now tracks every token source in a session, not just tool call inputs:
  - `UserPromptSubmit` hook — estimates tokens from every user message you send
  - `PostToolUse` hook — estimates tokens from tool outputs (file contents, bash stdout, search results, MCP responses) using actual response text length
  - `Stop` hook — captures real `input_tokens`, `output_tokens`, and `thinking_tokens` directly from the Claude API response when available; these override all estimates with ground truth
- **Real API data mode** — when the `Stop` hook provides actual token counts, `total_tokens` is replaced with the real context window size rather than a running estimate. The `/budget-guard:budget` report labels which mode is active: `[real API data]` vs `[estimated]`
- **New breakdown categories** in session state and the budget report:
  - `responses` — Claude's answer tokens (from Stop hook)
  - `user_messages` — your prompt tokens (from UserPromptSubmit)
  - `tool_results` — tool output tokens (from PostToolUse)
  - `thinking` — thinking tokens (from Stop hook, if present)
  - `cache` — cache read + creation tokens (from Stop hook, if present)
- **`turn_count`** — tracks how many conversation turns have occurred; shown in the budget report alongside tool call count
- **`has_real_data`** flag in session state — indicates whether at least one Stop hook has provided real API counts
- **`last_input_tokens`** field — snapshots the most recent API-reported input token count for trend analysis

### Changed

- `hooks/hooks.json` switched from shell form (`"command": "node \"...\""`) to exec form (`"command": "node"` + `"args": [...]`) — fixes unreliable hook firing on some platforms where shell PATH resolution differed
- Budget report breakdown table now shows all token categories; zero-value categories are hidden except `responses`, `user_messages`, and `file_ops` which are always shown
- Budget report now shows conversation turns count

### Fixed

- Marketplace name collision bug — renamed marketplace from `budget-guard` to `claude-code-labs` so the marketplace name and plugin name no longer share the same string, which caused Claude Code to misclassify the source type as unsupported
- `"source": "."` changed to `"source": "./"` in `marketplace.json` — bare dot was not recognised as a valid relative path by some Claude Code versions
- Added explicit `"skills"` array to `plugin.json` — matches the format used by all working community plugins
- Removed `$schema`, `displayName`, `homepage`, and `repository` fields from `plugin.json` — these non-standard fields caused install failures in some Claude Code versions

---

## [1.0.0] — 2026-05-22

### Added

- **`PreToolUse` hook** — fires before every tool call, estimates input token cost using actual data:
  - `Read` — uses real file size via `fs.statSync()`, respects `offset` and `limit` parameters
  - `Write` — measures actual content length
  - `Edit` / `MultiEdit` — measures combined old + new string lengths
  - `Bash` — command text length + fixed output overhead
  - `WebFetch` — fixed ~3,500 tokens (typical page)
  - `WebSearch` — fixed ~1,800 tokens
  - `Agent` / `Task` — fixed ~5,000 tokens (subagent spawn overhead)
  - `mcp__*` — fixed ~2,500 tokens
  - `Glob` / `Grep` / `LS` — fixed small values (200–350 tokens)

- **Four progressive warning tiers** delivered to Claude via `additionalContext` (non-blocking — never denies a tool call):
  - Advisory at `warn_threshold`% (default 60%)
  - Elevated at midpoint between warn and critical
  - Critical at `critical_threshold`% (default 85%)
  - Urgent at midpoint between critical and 100%
  - Each tier fires exactly once per session via persistent boolean flags

- **`SessionStart` hook** — initialises or restores session state on every session event:
  - `startup` / `clear` — archives previous session (if it had activity) and resets state
  - `resume` — restores accumulated state, updates config values
  - `compact` — keeps token count, resets warning flags, increments `compacted_count`

- **Interactive first-run setup wizard** — on the very first session start (no `config.json` found), opens the terminal directly via `/dev/tty` (macOS/Linux) or `\\.\CONIN$` / `\\.\CONOUT$` (Windows) and prompts for:
  - Session token budget (default: 100,000)
  - Warning threshold % (default: 60)
  - Critical threshold % (default: 85)
  - 30-second per-question timeout — falls back to defaults automatically if no input
  - Falls back silently to defaults in non-interactive environments (CI, pipes, containers)

- **`PostCompact` hook** — fires after `/compact`:
  - Resets `total_tokens` to the post-compact baseline reported by Claude Code
  - Resets all four warning flags so they re-fire naturally from the new baseline
  - Increments `compacted_count` and records `compacted_at` timestamp

- **`/budget-guard:budget` skill** — formatted live report including:
  - Progress bar (30-char filled/empty block)
  - Percentage used with absolute token counts
  - Status line: Healthy / Warning / Elevated / Critical
  - Context-aware recommendations based on dominant cost category
  - Session metadata: start time, elapsed time, compact count
  - Last-5-session history with per-session bar charts

- **`/budget-guard:reset` skill** — zeros all counters, clears all warning flags, and resets the session start time without ending the session

- **Config priority chain** (highest to lowest):
  1. `CLAUDE_BUDGET_GUARD_LIMIT` / `_WARN` / `_CRITICAL` env vars
  2. `CLAUDE_PLUGIN_OPTION_SESSION_BUDGET` / `_WARN_THRESHOLD` / `_CRITICAL_THRESHOLD` (plugin `userConfig` dialog)
  3. `${CLAUDE_PLUGIN_DATA}/config.json` (written by the first-run wizard)
  4. Hardcoded defaults (100,000 / 60% / 85%)

- **`userConfig`** in `plugin.json` — exposes the three settings in the Claude Code plugin configuration dialog with types, titles, descriptions, and valid ranges

- **Persistent session state** at `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json`:
  - Atomic writes (pid-unique temp file → `fs.renameSync`) prevent corruption from concurrent sessions
  - Session ID sanitised to a safe filename on all platforms

- **Session history** — last 50 completed sessions archived to `${CLAUDE_PLUGIN_DATA}/history.json`

- **Automatic 7-day pruning** of old session files to prevent unbounded disk growth

- **Pure Node.js implementation** — no native dependencies, no shell scripts, no platform-specific binaries; works identically on macOS, Linux, Windows, and WSL

- **`marketplace.json`** at `.claude-plugin/marketplace.json` enabling install via:
  ```
  /plugin marketplace add https://github.com/JS12540/budget-guard
  /plugin install budget-guard@claude-code-labs
  ```
