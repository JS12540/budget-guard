#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — Stop hook.
 *
 * Fires after every Claude turn. If the event includes real API usage
 * (input_tokens, output_tokens), those numbers replace our running estimate
 * with the ground truth — the actual context window size right now.
 *
 * If no real usage is present, adds a conservative estimate for Claude's
 * response (~500 tok) so the counter still grows between tool calls.
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
  const usage     = event.usage;

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

  if (usage && (usage.input_tokens || usage.output_tokens)) {
    // Real API token counts — override all estimates with ground truth.
    // input_tokens = entire context sent to the model this turn (history +
    // system prompt + tool calls/results + new user message).
    // This is the best single metric for "how full is the context window".
    const input  = usage.input_tokens  || 0;
    const output = usage.output_tokens || 0;
    const cache  = (usage.cache_read_input_tokens || 0) +
                   (usage.cache_creation_input_tokens || 0);

    state.total_tokens      = input + output;
    state.has_real_data     = true;
    state.last_input_tokens = input;

    state.breakdown.responses = (state.breakdown.responses || 0) + output;
    if (cache > 0) {
      state.breakdown.cache = (state.breakdown.cache || 0) + cache;
    }
    if (usage.thinking_tokens) {
      state.breakdown.thinking = (state.breakdown.thinking || 0) + usage.thinking_tokens;
    }
  } else {
    // No real data — add a conservative response estimate so the counter
    // grows even when the user is in a text-only back-and-forth.
    const estimatedResponse = 500;
    state.total_tokens += estimatedResponse;
    state.breakdown.responses = (state.breakdown.responses || 0) + estimatedResponse;
  }

  state.turn_count = (state.turn_count || 0) + 1;

  try { saveState(sessionId, state); } catch (_) {}
  process.exit(0);
}
