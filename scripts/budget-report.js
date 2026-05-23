#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — budget report generator.
 *
 * Called by the /budget-guard:budget skill via the Bash tool.
 * Reads current session state and history, then prints a formatted
 * budget report to stdout.
 *
 * Usage: node budget-report.js <session_id>
 */

const { loadState, loadHistory, getConfig } = require('./lib/state');

const sessionId = process.argv[2] || 'default';

try {
  main();
} catch (err) {
  process.stdout.write(`[Budget Guard] Error reading budget state: ${err.message}\n`);
  process.exit(0);
}

function main() {
  const config  = getConfig();
  const state   = loadState(sessionId);
  const history = loadHistory();

  const budget  = state.session_budget || config.session_budget;
  const used    = state.total_tokens   || 0;
  const pct     = Math.round((used / budget) * 100);
  const warn    = state.warn_threshold    || config.warn_threshold;
  const crit    = state.critical_threshold || config.critical_threshold;
  const calls   = state.call_count || 0;
  const bd      = state.breakdown || {};

  const lines = [];

  lines.push('');
  lines.push('══════════════════════════════════════════════');
  lines.push('   Budget Guard — Session Report');
  lines.push('══════════════════════════════════════════════');
  lines.push('');

  // Budget bar
  const barWidth = 30;
  const filled   = Math.min(barWidth, Math.round((pct / 100) * barWidth));
  const empty    = barWidth - filled;
  const bar      = '█'.repeat(filled) + '░'.repeat(empty);

  lines.push(`  Budget used:  ${pct}%`);
  lines.push(`  [${bar}]`);
  const dataLabel = state.has_real_data ? 'real API data' : 'estimated';
  lines.push(`  ~${fmt(used)} / ~${fmt(budget)} tokens  [${dataLabel}]`);
  lines.push('');

  // Status
  const status = pct >= crit
    ? '🔴 Critical  — run /compact soon'
    : pct >= Math.round((warn + crit) / 2)
    ? '🟠 Elevated  — approaching critical'
    : pct >= warn
    ? '⚠️  Warning   — past advisory threshold'
    : '🟢 Healthy   — well within budget';

  lines.push(`  Status:  ${status}`);
  lines.push(`  Thresholds:  warn at ${warn}%  ·  critical at ${crit}%`);
  lines.push('');

  // Turns + tool calls
  if (state.turn_count > 0) {
    lines.push(`  Conversation turns:  ${state.turn_count}`);
  }
  lines.push(`  Tool calls this session:  ${calls}`);
  if (state.started_at) {
    const elapsed = msToHuman(Date.now() - new Date(state.started_at).getTime());
    lines.push(`  Session started:  ${state.started_at.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}  (${elapsed})`);
  }
  if (state.compacted_count > 0) {
    lines.push(`  Compacted:  ${state.compacted_count}x  (last: ${state.compacted_at ? state.compacted_at.split('T')[1].slice(0, 8) + ' UTC' : 'n/a'})`);
  }
  lines.push('');

  // Breakdown
  lines.push('  ──────────────────────────────────────────');
  lines.push('  Breakdown by category:');
  lines.push('  ──────────────────────────────────────────');

  const cats = [
    { key: 'responses',     label: 'Responses   ', icon: '🧠' },
    { key: 'user_messages', label: 'Your msgs   ', icon: '💬' },
    { key: 'tool_results',  label: 'Tool output ', icon: '📤' },
    { key: 'file_ops',      label: 'File ops    ', icon: '📁' },
    { key: 'bash',          label: 'Bash        ', icon: '💻' },
    { key: 'search',        label: 'Search      ', icon: '🌐' },
    { key: 'mcp',           label: 'MCP         ', icon: '🔌' },
    { key: 'agent',         label: 'Agent       ', icon: '🤖' },
    { key: 'thinking',      label: 'Thinking    ', icon: '💭' },
    { key: 'other',         label: 'Other       ', icon: '🔧' }
  ].filter(c => (bd[c.key] || 0) > 0 || ['responses', 'user_messages', 'file_ops'].includes(c.key));

  const maxCost = Math.max(1, ...cats.map(c => bd[c.key] || 0));

  for (const cat of cats) {
    const cost    = bd[cat.key] || 0;
    const catPct  = used > 0 ? Math.round((cost / used) * 100) : 0;
    const barFill = Math.round((cost / maxCost) * 15);
    const catBar  = '▪'.repeat(barFill) + ' '.repeat(15 - barFill);
    lines.push(`  ${cat.icon} ${cat.label}  ${catBar}  ${padL(fmt(cost), 7)} tok  (${padL(catPct + '%', 4)})`);
  }

  lines.push('');

  // Recommendations
  lines.push('  ──────────────────────────────────────────');
  lines.push('  Recommendations:');
  lines.push('  ──────────────────────────────────────────');

  const tips = buildTips(pct, warn, crit, bd, used);
  for (const tip of tips) {
    lines.push(`  • ${tip}`);
  }
  lines.push('');

  // History (last 5 sessions)
  if (history.length > 0) {
    lines.push('  ──────────────────────────────────────────');
    lines.push('  Recent sessions (last 5):');
    lines.push('  ──────────────────────────────────────────');
    const recent = history.slice(-5).reverse();
    for (const h of recent) {
      const date = (h.started_at || h.ended_at || '').split('T')[0] || '?';
      const hp   = h.pct_used || Math.round((h.total_tokens / h.session_budget) * 100);
      const hbar = '█'.repeat(Math.min(20, Math.round(hp / 5)));
      lines.push(`  ${date}  ${padL(hp + '%', 4)}  [${hbar.padEnd(20)}]  ${fmt(h.total_tokens)} tok  (${h.call_count} calls)`);
    }
    lines.push('');
  }

  lines.push('  Run /budget-guard:reset to zero the counter.');
  lines.push('  Set budget via CLAUDE_BUDGET_GUARD_LIMIT env var or plugin userConfig.');
  lines.push('══════════════════════════════════════════════');
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------

function buildTips(pct, warn, crit, bd, used) {
  const tips = [];

  if (pct >= 95) {
    tips.push('Run /compact immediately — you are nearly at the context limit.');
    tips.push('Stop using WebFetch, WebSearch, Agent, and MCP tools.');
    tips.push('Use offset/limit on any Read calls to read only the lines you need.');
  } else if (pct >= crit) {
    tips.push('Run /compact to reclaim context and get a fresh budget.');
    tips.push('Prefer Grep/Glob for exploration instead of reading whole files.');
    tips.push('Avoid spawning Agent subagents — they create additional context.');
  } else if (pct >= warn) {
    const dominant = Object.entries(bd).sort((a, b) => b[1] - a[1])[0];
    if (dominant && dominant[0] === 'file_ops') {
      tips.push('File operations are the biggest cost. Use Grep/Glob to search instead of Read.');
      tips.push('When reading files, use the offset and limit parameters to read only relevant sections.');
    } else if (dominant && dominant[0] === 'search') {
      tips.push('Web searches/fetches are costly. Cache results and avoid re-fetching.');
      tips.push('Use WebSearch (snippet-only) instead of WebFetch when you don\'t need full pages.');
    } else if (dominant && dominant[0] === 'mcp') {
      tips.push('MCP calls are the biggest cost. Batch MCP operations where possible.');
    }
    tips.push('Consider running /compact if you still have a lot of work ahead.');
  } else {
    tips.push('Budget is healthy. No action needed.');
    tips.push('Check back with /budget-guard:budget as work progresses.');
  }

  return tips;
}

function msToHuman(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function padL(s, w) {
  return String(s).padStart(w);
}
