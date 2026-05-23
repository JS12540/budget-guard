#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — PostToolUse hook.
 *
 * Fires after each tool call with the tool's output/result.
 * Estimates the token cost of what Claude receives back (file content,
 * bash output, search results, etc.) — this is often larger than the
 * tool input and was previously untracked.
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
  const toolName  = event.tool_name  || 'unknown';

  // Claude Code may use different field names for the tool result.
  const response = event.tool_response ?? event.output ?? event.result ?? event.content;
  if (response === undefined || response === null) {
    process.exit(0);
    return;
  }

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

  // Estimate tokens from the actual response size.
  const text = typeof response === 'string' ? response : JSON.stringify(response);
  const cost = Math.max(100, Math.floor(text.length / 4) + 50);

  state.total_tokens += cost;
  state.breakdown.tool_results = (state.breakdown.tool_results || 0) + cost;

  try { saveState(sessionId, state); } catch (_) {}
  process.exit(0);
}
