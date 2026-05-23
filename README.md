# Budget Guard

> A Claude Code plugin that tracks **full session token usage** — your messages, Claude's responses, tool calls and outputs, and thinking tokens — warns Claude at configurable thresholds, and gives you a real-time breakdown of where your context window is going.

---

## Table of Contents

- [What it does](#what-it-does)
- [What gets tracked](#what-gets-tracked)
- [Install](#install)
  - [From GitHub (recommended)](#from-github-recommended)
  - [From a local clone](#from-a-local-clone)
  - [Uninstall](#uninstall)
  - [Requirements](#requirements)
- [Configuration](#configuration)
  - [Plugin dialog](#1-plugin-dialog-on-install)
  - [Environment variables](#2-environment-variables-override)
- [Slash commands](#slash-commands)
- [How token costs are estimated](#how-token-costs-are-estimated)
- [Warning tiers](#warning-tiers)
- [State and data](#state-and-data)
- [Platforms](#platforms)
- [Privacy](#privacy)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

Claude Code sessions have a finite context window. When it fills up, Claude Code auto-compacts — which can lose important context or interrupt a long task at a bad time. **Budget Guard** helps you get ahead of that.

- **Tracks every token source** — your messages, Claude's responses, tool inputs, tool outputs, and thinking tokens
- **Uses real API data when available** — the `Stop` hook captures actual `input_tokens` and `output_tokens` from the API response, replacing estimates with ground truth
- **Four progressive warning tiers** — advisory → elevated → critical → urgent — each fires exactly once per session
- **Warns Claude via `additionalContext`** — Claude sees the warning and can adjust its approach (prefer smaller reads, avoid WebFetch, suggest /compact)
- **Reset-aware** — after `/compact`, warning flags reset and the token counter updates to the post-compact baseline
- **Session history** — keeps the last 50 sessions for trend analysis
- **Two slash commands**: `/budget-guard:budget` for a live report, `/budget-guard:reset` to zero the counter

---

## What gets tracked

Budget Guard hooks into **six Claude Code events** to capture every token source in a session:

| Hook | What it captures |
|---|---|
| `UserPromptSubmit` | Your message text — every prompt you send adds to the context |
| `PreToolUse` | Tool call inputs — file paths, bash commands, search queries |
| `PostToolUse` | Tool outputs — file contents, bash output, search results returned to Claude |
| `Stop` | Claude's response tokens — the actual answer text; uses **real API counts** if available |
| `SessionStart` | Initialises session state and budget config |
| `PostCompact` | Resets the counter to the post-compact baseline after `/compact` |

When the `Stop` event provides real `input_tokens` / `output_tokens` from the API, those numbers replace all running estimates — giving you the actual context window size, not a heuristic.

The `/budget-guard:budget` report shows whether you are seeing **real API data** or **estimated** counts.

---

## Install

### From GitHub (recommended)

**Step 1 — Open Claude Code** in any directory:

```bash
claude
```

**Step 2 — Add the GitHub repo as a marketplace**

```
/plugin marketplace add https://github.com/JS12540/budget-guard
```

You should see: `Successfully added marketplace: claude-code-labs`

**Step 3 — Install the plugin**

```
/plugin install budget-guard@claude-code-labs
```

A panel opens — select **Install for you (user scope)** and confirm.

**Step 4 — Fully quit and relaunch Claude Code**

`/reload-plugins` alone is not enough — hooks only wire up correctly on a fresh launch:

```bash
# Quit Claude Code, then:
claude
```

**Step 5 — First-run setup wizard**

On first session start, a wizard appears in the terminal:

```
┌─────────────────────────────────────────────┐
│  Budget Guard — First-Run Setup             │
│  Press Enter to accept the default value.   │
└─────────────────────────────────────────────┘

  Session token budget [100000]:
  Warning threshold %  [60]:
  Critical threshold % [85]:
```

Press Enter three times to accept the defaults, or type your own values.

**Step 6 — Verify it's working**

Send a message and run:

```
/budget-guard:budget
```

You should see a live report with non-zero token counts across all categories (your messages, responses, tool calls, tool outputs).

---

### From a local clone

Use this if you want to develop or modify the plugin locally.

**Step 1 — Clone the repo**

```bash
git clone https://github.com/JS12540/budget-guard.git
cd budget-guard
```

**Step 2 — Open Claude Code**

```bash
claude
```

**Step 3 — Add the cloned folder as a marketplace**

```
/plugin marketplace add /path/to/budget-guard
```

Replace `/path/to/budget-guard` with the actual path where you cloned the repo.  
Example: `/Users/yourname/projects/budget-guard`

You should see: `Successfully added marketplace: claude-code-labs`

**Step 4 — Install**

```
/plugin install budget-guard@claude-code-labs
```

Select **Install for you (user scope)** and confirm.

**Step 5 — Fully quit and relaunch Claude Code**

```bash
claude
```

---

### Uninstall

```
/plugin uninstall budget-guard
/plugin marketplace remove claude-code-labs
```

---

### Requirements

- **Claude Code latest version** — if you get a "source type not supported" error, update:
  ```bash
  npm install -g @anthropic-ai/claude-code@latest
  ```
- **Node.js** — included with Claude Code, no separate install needed

---

## Configuration

Budget Guard has three configurable values.

### 1. Plugin dialog (on install)

On first session start, a terminal wizard asks for your budget and thresholds:

| Setting | Description | Default |
|---|---|---|
| Session token budget | Max tokens per session (context window size) | `100000` |
| Warning threshold (%) | Advisory warning at this percentage | `60` |
| Critical threshold (%) | Critical warning at this percentage | `85` |

**Plan reference:**

| Plan | Approximate session budget |
|---|---|
| Claude Pro | ~100,000 tokens |
| Claude Max | ~200,000 tokens |
| Teams / Enterprise | Check your plan |

To re-run the wizard, delete the config file:

```bash
rm ~/.claude/plugins/data/budget-guard/config.json
```

### 2. Environment variables (override)

Set these in your shell profile to override wizard values at any time:

```bash
export CLAUDE_BUDGET_GUARD_LIMIT=200000   # total token budget
export CLAUDE_BUDGET_GUARD_WARN=55        # advisory warning %
export CLAUDE_BUDGET_GUARD_CRITICAL=80    # critical warning %
```

Env vars take priority over the wizard config.

---

## Slash commands

| Command | Description |
|---|---|
| `/budget-guard:budget` | Show live report with full breakdown, progress bar, status, conversation turns, and recommendations |
| `/budget-guard:reset` | Zero the counter and reset all warning flags for this session |

---

## How token costs are estimated

Budget Guard uses real data wherever available, and conservative heuristics as fallback.

### Real data (when available)

| Source | Method |
|---|---|
| Claude's responses | `Stop` hook captures actual `output_tokens` from the API |
| Full context size | `Stop` hook captures actual `input_tokens` — the ground truth for context window fullness |
| Thinking tokens | `Stop` hook captures `thinking_tokens` if present |

When real data is available, the report shows `[real API data]`. Otherwise it shows `[estimated]`.

### Estimated (heuristic)

| Source | Method |
|---|---|
| Your messages | Message character length ÷ 4 + framing overhead |
| Tool outputs | Actual response text length ÷ 4 (from `PostToolUse`) |
| `Read` input | Actual file size via `fs.statSync()`, accounts for `offset`/`limit` |
| `Write` input | Actual content length |
| `Edit` / `MultiEdit` input | Combined old + new string lengths |
| `Bash` input | Command text length + fixed output overhead |
| `WebFetch` | Fixed ~3,500 tokens |
| `WebSearch` | Fixed ~1,800 tokens |
| `Agent` / `Task` | Fixed ~5,000 tokens |
| `mcp__*` | Fixed ~2,500 tokens |
| `Glob`, `Grep`, `LS` | Fixed small values (200–350 tokens) |

---

## Warning tiers

| Tier | Threshold | What Claude sees |
|---|---|---|
| Advisory | `warn_threshold`% (default 60%) | Budget usage note with full breakdown |
| Elevated | Midpoint between warn and critical | Stronger nudge to prefer targeted tool calls |
| Critical | `critical_threshold`% (default 85%) | Recommendation to run `/compact` |
| Urgent | Midpoint between critical and 100% | Strong push to compact immediately |

Each tier fires **exactly once per session**. After `/compact`, all flags reset automatically.

---

## State and data

Budget Guard stores state in `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json` — a persistent directory managed by Claude Code that survives plugin updates.

| File | Purpose |
|---|---|
| `sessions/<id>.json` | Live state for the current session |
| `history.json` | Last 50 completed sessions |
| `config.json` | Your wizard-configured budget and thresholds |

- Session files are pruned automatically after 7 days
- All writes are atomic (temp file → rename) to prevent corruption from concurrent sessions

---

## Platforms

Works on **macOS, Linux, and Windows** — all hook scripts are plain Node.js with no native dependencies or shell-specific syntax.

| Platform | Status | Notes |
|---|---|---|
| macOS | Supported | Native |
| Linux | Supported | Native |
| Windows (native) | Supported | Node.js handles all path differences |
| Windows (WSL) | Supported | Runs as Linux |

---

## Privacy

Budget Guard never sends any data outside your machine. All state is stored locally in `${CLAUDE_PLUGIN_DATA}`. No telemetry, no network calls.

---

## Contributing

Issues and PRs welcome at [github.com/JS12540/budget-guard](https://github.com/JS12540/budget-guard).

---

## License

MIT — see [LICENSE](./LICENSE).
