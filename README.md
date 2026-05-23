# Budget Guard

> A Claude Code plugin that tracks estimated token usage per tool call, warns Claude at configurable thresholds, and gives you a real-time breakdown of where your session budget is going.

---

## Table of Contents

- [What it does](#what-it-does)
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

- **Fires before every tool call** — estimates the token cost using actual tool input data (real file sizes, content lengths, etc.)
- **Four progressive warning tiers** — advisory → elevated → critical → urgent — each fires exactly once per session
- **Warns Claude via `additionalContext`** — Claude sees the warning and can adjust its approach (prefer smaller reads, avoid WebFetch, suggest /compact)
- **Reset-aware** — after `/compact`, warning flags reset and the token counter updates to the post-compact baseline
- **Session history** — keeps the last 50 sessions for trend analysis
- **Two slash commands**: `/budget-guard:budget` for a live report, `/budget-guard:reset` to zero the counter

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

You should see: `Successfully added marketplace: budget-guard`

**Step 3 — Install the plugin**

```
/plugin install budget-guard@budget-guard
```

A panel opens — select **Install for you (user scope)** and confirm.

**Step 4 — Reload plugins**

```
/reload-plugins
```

**Step 5 — Start a fresh session**

```
/new
```

On first run, a setup wizard appears in the terminal:

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

Make any tool call (e.g. ask Claude to read a file), then run:

```
/budget-guard:budget
```

You should see a live report with non-zero token counts, a progress bar, and a per-tool breakdown.

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

Replace `/path/to/budget-guard` with the actual path.  
Example: `/Users/yourname/projects/budget-guard`

You should see: `Successfully added marketplace: budget-guard`

**Step 4 — Install**

```
/plugin install budget-guard@budget-guard
```

Select **Install for you (user scope)** and confirm.

**Step 5 — Reload and start fresh**

```
/reload-plugins
/new
```

---

### Uninstall

```
/plugin uninstall budget-guard
/plugin marketplace remove budget-guard
```

---

### Requirements

- **Claude Code latest version** — the marketplace `source` type requires a recent build. Update with:
  ```bash
  npm install -g @anthropic-ai/claude-code@latest
  ```
- **Node.js** — included with Claude Code, no separate install needed

---

## Configuration

Budget Guard has three configurable values.

### 1. Plugin dialog (on install)

When you install the plugin, a terminal wizard runs on first session start:

| Setting | Description | Default |
|---|---|---|
| Session token budget | Estimated max tokens per session | `100000` |
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

Set these in your shell profile to override the wizard values at any time:

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
| `/budget-guard:budget` | Show live budget report with breakdown, progress bar, status, and recommendations |
| `/budget-guard:reset` | Zero the counter and reset all warning flags for this session |

---

## How token costs are estimated

Budget Guard uses a heuristic cost model — it is an estimate, not the actual Claude API token count. Estimates are intentionally conservative (they round up) so you get early warnings rather than late ones.

| Tool | Estimation method |
|---|---|
| `Read` | Actual file size via `fs.statSync()`, accounts for `offset`/`limit` parameters |
| `Write` | Actual content length |
| `Edit` / `MultiEdit` | Combined old + new string lengths |
| `Bash` | Command text length + fixed output overhead |
| `WebFetch` | Fixed ~3,500 tokens (typical page content) |
| `WebSearch` | Fixed ~1,800 tokens |
| `Agent` / `Task` | Fixed ~5,000 tokens (subagent spawn overhead) |
| `mcp__*` | Fixed ~2,500 tokens |
| `Glob`, `Grep`, `LS` | Fixed small values (200–350 tokens) |

---

## Warning tiers

| Tier | Threshold | What Claude sees |
|---|---|---|
| Advisory | `warn_threshold`% (default 60%) | Budget usage note with per-tool breakdown |
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

Works on **macOS, Linux, and Windows** — hook scripts are plain Node.js with no native dependencies or shell-specific syntax.

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
