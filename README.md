# Budget Guard

> A Claude Code plugin that tracks estimated token usage per tool call, warns Claude at configurable thresholds, and gives you a real-time breakdown of where your session budget is going.

---

## Table of Contents

- [What it does](#what-it-does)
- [Install](#install)
  - [From the community marketplace](#from-the-community-marketplace)
  - [From a local directory (development / self-hosted)](#from-a-local-directory-development--self-hosted)
  - [Requirements](#requirements)
- [Configuration](#configuration)
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

### From the community marketplace

Once the plugin is listed on the Claude Code community marketplace:

```
/plugin install budget-guard@claude-community
```

---

### From a local directory (development / self-hosted)

Use this method to install directly from a cloned copy of this repository.

**Step 1 — Clone the repository**

```bash
git clone https://github.com/JS12540/security-budget-guard.git
```

**Step 2 — Open Claude Code** in any directory:

```bash
claude
```

**Step 3 — Register the folder as a local marketplace**

```
/plugin marketplace add /path/to/security-budget-guard
```

Replace `/path/to/security-budget-guard` with the actual path where you cloned the repo.  
Example: `/Users/yourname/projects/security-budget-guard`

You should see: `Successfully added marketplace: local-dev`

**Step 4 — Install the plugin from that marketplace**

```
/plugin install budget-guard@local-dev
```

A panel will open. Select **Install for you (user scope)** and confirm.

**Step 5 — Reload plugins**

```
/reload-plugins
```

**Step 6 — Start a fresh session**

```
/new
```

The `SessionStart` hook will fire and show:

```
[Budget Guard] Session budget: ~100,000 tokens. Warnings fire at 60% and 85%. Run /budget-guard:budget for live breakdown.
```

On first run, a setup wizard will appear in the terminal asking for your budget and thresholds. Press Enter to accept the defaults.

**Step 7 — Verify it's working**

Make any tool call (e.g. ask Claude to read a file), then run:

```
/budget-guard:budget
```

You should see a live token breakdown with non-zero counts.

---

### Uninstall

```
/plugin uninstall budget-guard
/plugin marketplace remove local-dev
```

---

### Requirements

- Claude Code **latest version** (local marketplace source type requires a recent build — run `claude --version` and update if needed)
- Node.js (included with Claude Code — no separate install needed)

---

## Configuration

Budget Guard has **three configurable values**. Set them in one of two ways:

### 1. Plugin userConfig (recommended)

When you first enable the plugin, Claude Code shows a configuration dialog:

| Setting | Description | Default |
|---|---|---|
| Session token budget | Estimated max tokens per session | `100000` |
| Warning threshold (%) | Advisory warning at this percentage | `60` |
| Critical threshold (%) | Critical warning at this percentage | `85` |

**Plan reference:**
- Claude Pro: ~100,000 tokens per session
- Claude Max: ~200,000 tokens per session
- Teams / Enterprise: check your plan details

### 2. Environment variables (override)

Set these in your shell profile to override userConfig values without editing anything:

```bash
export CLAUDE_BUDGET_GUARD_LIMIT=200000   # total token budget
export CLAUDE_BUDGET_GUARD_WARN=55        # advisory warning %
export CLAUDE_BUDGET_GUARD_CRITICAL=80    # critical warning %
```

Env vars take priority over the plugin's userConfig dialog values.

---

## Slash commands

| Command | Description |
|---|---|
| `/budget-guard:budget` | Show live budget report with breakdown, progress bar, status, and recommendations |
| `/budget-guard:reset` | Zero the counter and reset all warning flags for this session |

---

## How token costs are estimated

Budget Guard uses a heuristic cost model — it is an estimate, not the actual Claude API token count. The estimates are intentionally conservative (they tend to round up) so you get early warnings rather than late ones.

| Tool | Estimation method |
|---|---|
| `Read` | Checks actual file size via `fs.statSync()`. Accounts for `offset`/`limit` parameters. |
| `Write` | Measures actual content length |
| `Edit` / `MultiEdit` | Measures combined old + new string lengths |
| `Bash` | Command text length + fixed output overhead |
| `WebFetch` | Fixed ~3,500 tok (typical page content) |
| `WebSearch` | Fixed ~1,800 tok |
| `Agent` / `Task` | Fixed ~5,000 tok (subagent spawn overhead) |
| `mcp__*` | Fixed ~2,500 tok |
| `Glob`, `Grep`, `LS` | Fixed small values (200–350 tok) |

---

## Warning tiers

| Tier | Threshold | What happens |
|---|---|---|
| Advisory | `warn_threshold`% (default 60%) | Claude sees a note about budget usage and the breakdown |
| Elevated | midpoint between warn and critical | Stronger nudge to prefer targeted tool calls |
| Critical | `critical_threshold`% (default 85%) | Recommendation to run /compact |
| Urgent | midpoint between critical and 100% | Strong push to compact immediately |

Each tier fires **once per session**. After `/compact`, all flags reset.

---

## State and data

Budget Guard stores state in `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json` — a persistent directory managed by Claude Code that survives plugin updates.

- Session files are pruned automatically after 7 days
- History of the last 50 sessions is kept in `${CLAUDE_PLUGIN_DATA}/history.json`
- State writes are atomic (temp file → rename) to prevent corruption from concurrent sessions

---

## Platforms

Works on **macOS, Linux, and Windows** — the hook scripts are plain Node.js with no native dependencies or shell-specific syntax.

---

## Cross-platform compatibility notes

| Platform | Works? | Notes |
|---|---|---|
| macOS | ✅ | Native |
| Linux | ✅ | Native |
| Windows (native) | ✅ | Node.js handles all path differences |
| Windows (WSL) | ✅ | Runs as Linux |

---

## Privacy

Budget Guard never sends any data outside your machine. All state is stored locally in `${CLAUDE_PLUGIN_DATA}`. No telemetry, no network calls.

---

## Contributing

Issues and PRs welcome at [github.com/JS12540/security-budget-guard](https://github.com/JS12540/security-budget-guard).

---

## License

MIT — see [LICENSE](./LICENSE).
