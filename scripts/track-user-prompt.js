#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — UserPromptSubmit hook.
 *
 * Fires when the user sends a message. Estimates the token cost of the
 * user's message text — previously untracked, even though every message
 * adds to the context window.
 */

const { loadState, saveState, getConfig, DEFAULT_STATE } = require('./lib/state');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try { main(JSON.parse(raw || '{}')); }
  catch (_) {}
  process.exit(0);
});

function main(event) {
  const sessionId = event.session_id || 'default';

  // Claude Code may send the message under different field names.
  const message = event.prompt ?? event.user_message ?? event.message ?? event.content ?? '';

  const config = getConfig();
  let state = loadState(sessionId);

  if (state.session_id !== sessionId) {
    state = Object.assign({}, DEFAULT_STATE, {
      session_id:         sessionId,
      session_budget:     config.session_budget,
      warn_threshold:     config.warn_threshold,
      critical_threshold: config.critical_threshold,
      started_at:         new Date().toISOString()
    });
  }

  // ~4 chars per token + fixed overhead for message framing.
  const cost = Math.max(50, Math.floor(message.length / 4) + 50);

  state.total_tokens += cost;
  state.breakdown.user_messages = (state.breakdown.user_messages || 0) + cost;

  try { saveState(sessionId, state); } catch (_) {}
  process.exit(0);
}
