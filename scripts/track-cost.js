#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — PreToolUse hook.
 *
 * Fires before every tool call.  Estimates the token cost of the call using
 * actual tool input data (file sizes, content lengths, etc.), updates the
 * session state, and emits advisory warnings via `additionalContext` when
 * budget thresholds are crossed.
 *
 * This hook never denies tool calls — it is purely advisory.  The goal is to
 * give Claude the information it needs to make smarter choices, not to block
 * work mid-session.
 *
 * Exit codes:
 *   0 — tool proceeds normally (always used here)
 *   stdout (JSON) — additionalContext injected when a threshold is crossed
 *   stdout (empty) — silent pass when under threshold
 */

const fs   = require('fs');
const path = require('path');
const { loadState, saveState, getConfig, DEFAULT_STATE } = require('./lib/state');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try { main(JSON.parse(raw || '{}')); }
  catch (_) { process.exit(0); }
});

function main(event) {
  const sessionId = event.session_id || 'default';
  const toolName  = event.tool_name  || 'unknown';
  const toolInput = event.tool_input || {};

  const config = getConfig();
  let state = loadState(sessionId);

  // If session_id in state doesn't match (e.g. state was reset externally),
  // re-initialise rather than accumulating into a stale bucket.
  if (state.session_id !== sessionId) {
    state = Object.assign({}, DEFAULT_STATE, {
      session_id:         sessionId,
      session_budget:     config.session_budget,
      warn_threshold:     config.warn_threshold,
      critical_threshold: config.critical_threshold,
      started_at:         new Date().toISOString()
    });
  }

  // --- Cost estimation ---
  const cost     = estimateCost(toolName, toolInput);
  const category = categorise(toolName);

  // Update totals.
  state.total_tokens               += cost;
  state.call_count                 += 1;
  state.breakdown[category]        += cost;

  const budget  = state.session_budget  || config.session_budget;
  const pct     = Math.round((state.total_tokens / budget) * 100);

  // --- Threshold evaluation ---
  const warn     = state.warn_threshold    || config.warn_threshold;
  const crit     = state.critical_threshold || config.critical_threshold;

  // Midpoints between warn and crit, and between crit and 100.
  const mid1 = Math.round((warn + crit) / 2);
  const mid2 = Math.round((crit + 100) / 2);

  let message = null;

  if (pct >= mid2 && !state.warned_95) {
    state.warned_95 = true;
    message = buildWarning('🔴 CRITICAL', pct, state, budget, [
      'Run /compact NOW to free context before hitting the limit.',
      'Avoid WebFetch, WebSearch, Agent, and MCP calls.',
      'Switch to smallest possible reads — use Grep/Glob instead of Read.',
      'If you must read files, use the offset/limit parameters.'
    ]);
  } else if (pct >= crit && !state.warned_90) {
    state.warned_90 = true;
    message = buildWarning('🟠 Critical', pct, state, budget, [
      'Consider running /compact to reclaim context.',
      'Prefer targeted Grep/Glob over full file reads.',
      'Avoid large WebFetch or multi-tool Agent calls.'
    ]);
  } else if (pct >= mid1 && !state.warned_80) {
    state.warned_80 = true;
    message = buildWarning('⚠️  Elevated', pct, state, budget, [
      'Budget is climbing. Prefer smaller, targeted tool calls.',
      'Use Grep to find exact lines rather than reading whole files.',
      'Consider /compact if you have a lot more work to do.'
    ]);
  } else if (pct >= warn && !state.warned_60) {
    state.warned_60 = true;
    message = buildWarning('💛 Advisory', pct, state, budget, [
      'You are past the advisory threshold. Budget is being tracked.',
      'Favour targeted reads and avoid large file operations where possible.',
      'Run /budget-guard:budget for a full breakdown.'
    ]);
  }

  // Save state (best-effort — never crash the hook).
  try { saveState(sessionId, state); } catch (_) {}

  if (message) {
    // Output structured JSON so Claude sees additionalContext.
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: message
      }
    };
    process.stdout.write(JSON.stringify(output) + '\n');
  }
  // Silent exit when under threshold — no output means no overhead.
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Token cost estimation
//
// Uses actual tool input data where available (file sizes, content lengths)
// to produce more accurate estimates than fixed per-tool constants.
// All estimates are conservative: we'd rather overcount and prompt caution
// early than undercount and surprise the user at the hard limit.
// ---------------------------------------------------------------------------

function estimateCost(toolName, input) {
  switch (toolName) {
    case 'Read': {
      // Try to get the real file size — much more accurate than a constant.
      const fp = input.file_path;
      if (fp) {
        try {
          const size = fs.statSync(fp).size;
          // Account for pagination: if limit is set, only part of the file is read.
          const limit  = input.limit  || Infinity;
          const offset = input.offset || 0;
          // Estimate chars in the slice that will be returned.
          const charsRead = Math.min(size - offset, limit * 80); // ~80 chars/line
          const tokens = Math.max(300, Math.floor(charsRead / 4) + 250);
          return Math.min(tokens, 60000); // cap at ~60k (very large files)
        } catch (_) {}
      }
      return 900;
    }

    case 'Write': {
      const content = input.content || '';
      return Math.max(400, Math.floor(content.length / 4) + 400);
    }

    case 'Edit': {
      const old_ = input.old_string || '';
      const new_ = input.new_string || '';
      return Math.max(250, Math.floor((old_.length + new_.length) / 4) + 300);
    }

    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      const total = edits.reduce(
        (sum, e) => sum + (e.old_string || '').length + (e.new_string || '').length,
        0
      );
      return Math.max(400, Math.floor(total / 4) + 400);
    }

    case 'Bash': {
      const cmd = input.command || '';
      // Command text is cheap; output can be large but we can't predict it.
      return Math.max(300, Math.floor(cmd.length / 4) + 700);
    }

    case 'Glob':
      return 250;

    case 'Grep':
      return 350;

    case 'LS':
      return 200;

    case 'WebFetch':
      // Fetching a whole page can be very large. 3000 is a conservative average.
      return 3500;

    case 'WebSearch':
      return 1800;

    case 'Task':
    case 'Agent':
      // Spawning a subagent creates a whole new context; cost is significant.
      return 5000;

    case 'AskUserQuestion':
      return 150;

    case 'ExitPlanMode':
    case 'EnterPlanMode':
      return 100;

    default:
      if (toolName.startsWith('mcp__')) {
        // MCP tools vary widely; use a generous estimate.
        return 2500;
      }
      return 450;
  }
}

function categorise(toolName) {
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS'].includes(toolName)) {
    return 'file_ops';
  }
  if (toolName === 'Bash') return 'bash';
  if (toolName.startsWith('mcp__')) return 'mcp';
  if (['WebFetch', 'WebSearch'].includes(toolName)) return 'search';
  if (['Task', 'Agent'].includes(toolName)) return 'agent';
  return 'other';
}

// ---------------------------------------------------------------------------
// Warning message builder
// ---------------------------------------------------------------------------

function buildWarning(level, pct, state, budget, tips) {
  const used = state.total_tokens;
  const bd   = state.breakdown;

  const lines = [
    `Budget Guard ${level}: ~${pct}% of session budget used`,
    `  Estimated: ${fmt(used)} / ${fmt(budget)} tokens`,
    `  Tool calls: ${state.call_count}`,
    ``,
    `  Breakdown:`,
    `    File ops : ${fmt(bd.file_ops)} tok`,
    `    Bash     : ${fmt(bd.bash)} tok`,
    `    Search   : ${fmt(bd.search)} tok`,
    `    MCP      : ${fmt(bd.mcp)} tok`,
    `    Agent    : ${fmt(bd.agent)} tok`,
    `    Other    : ${fmt(bd.other)} tok`,
    ``
  ];

  if (tips.length > 0) {
    lines.push('  Guidance:');
    for (const tip of tips) {
      lines.push(`    • ${tip}`);
    }
    lines.push('');
  }

  lines.push('  Run /budget-guard:budget for a full interactive report.');

  return lines.join('\n');
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}
