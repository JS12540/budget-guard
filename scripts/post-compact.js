#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — PostCompact hook.
 *
 * Fires after /compact completes.  The context window has been compacted, so
 * the effective token usage is now `tokens_after` (provided by Claude Code).
 * We update the session state to reflect this new baseline and reset warning
 * flags so fresh warnings can fire as usage climbs again.
 *
 * Exit 0 always — PostCompact cannot block anything.
 */

const { loadState, saveState, getConfig } = require('./lib/state');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try { main(JSON.parse(raw || '{}')); }
  catch (_) { process.exit(0); }
});

function main(event) {
  const sessionId   = event.session_id   || 'default';
  const tokensBefore = event.tokens_before || 0;
  const tokensAfter  = event.tokens_after  || 0;
  const trigger      = event.trigger       || 'manual';

  const config = getConfig();
  const state  = loadState(sessionId);

  // Use Claude Code's reported post-compact token count as the new baseline.
  // If not provided (older CC versions), keep existing count.
  const newTotal = tokensAfter > 0 ? tokensAfter : state.total_tokens;

  const updated = Object.assign({}, state, {
    total_tokens:       newTotal,
    // Reset warning flags so thresholds re-fire naturally from the new baseline.
    warned_60:          false,
    warned_80:          false,
    warned_90:          false,
    warned_95:          false,
    compacted_at:       new Date().toISOString(),
    compacted_count:    (state.compacted_count || 0) + 1
  });

  try { saveState(sessionId, updated); } catch (_) {}

  // Output a brief context message so Claude knows the budget counter was reset.
  const budget = state.session_budget || config.session_budget;
  const pct    = Math.round((newTotal / budget) * 100);

  const msg = [
    `[Budget Guard] Context compacted (${trigger}). `,
    `Tokens before: ~${fmt(tokensBefore)}, after: ~${fmt(newTotal)} (~${pct}% of ${fmt(budget)}).`,
    ` Budget warning flags reset — they will re-fire as usage climbs.`
  ].join('');

  process.stdout.write(msg + '\n');
  process.exit(0);
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}
