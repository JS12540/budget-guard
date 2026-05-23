#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — budget reset.
 *
 * Called by the /budget-guard:reset skill via the Bash tool.
 * Resets all budget counters for the current session to zero.
 *
 * Usage: node reset-budget.js <session_id>
 */

const { loadState, saveState, DEFAULT_STATE, getConfig } = require('./lib/state');

const sessionId = process.argv[2] || 'default';

try {
  main();
} catch (err) {
  process.stdout.write(`[Budget Guard] Reset failed: ${err.message}\n`);
  process.exit(0);
}

function main() {
  const config = getConfig();
  const state  = loadState(sessionId);

  const fresh = Object.assign({}, DEFAULT_STATE, {
    session_id:          sessionId,
    session_budget:      state.session_budget || config.session_budget,
    warn_threshold:      state.warn_threshold  || config.warn_threshold,
    critical_threshold:  state.critical_threshold || config.critical_threshold,
    started_at:          new Date().toISOString()
  });

  saveState(sessionId, fresh);

  process.stdout.write(
    '✅ Budget Guard reset.\n' +
    `   Session budget: ~${Number(fresh.session_budget).toLocaleString('en-US')} tokens.\n` +
    `   All counters cleared. Warning flags reset.\n`
  );
}
