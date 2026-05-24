#!/usr/bin/env node
'use strict';

/**
 * Budget Guard — SessionStart hook.
 *
 * On FIRST run (no config.json exists): opens the terminal directly and runs
 * an interactive setup wizard so the user can enter their session budget and
 * thresholds.  Falls back to defaults automatically after 30 seconds or if
 * the terminal is unavailable (CI, non-interactive shells, Windows without
 * console, etc.).
 *
 * On subsequent runs: loads existing config, restores or resets session state,
 * and emits a brief context message that Claude sees at the top of the session.
 *
 * Exit 0 always — this hook must never block a session from starting.
 */

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const {
  loadState, saveState, archiveSession, pruneOldSessions,
  getConfig, saveConfig, configExists, DEFAULT_STATE
} = require('./lib/state');

// Consume stdin first — Claude Code delivers the event JSON there.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  // Wrap in an async IIFE so we can use await for the setup wizard.
  (async () => {
    try { await main(JSON.parse(raw || '{}')); }
    catch (_) { /* never crash the hook */ }
    process.exit(0);
  })();
});

async function main(event) {
  const sessionId = event.session_id || 'default';
  const source    = event.source     || 'startup'; // startup|resume|clear|compact

  // ── First-run setup wizard ────────────────────────────────────────────────
  // Runs exactly once: when config.json doesn't yet exist.
  // After the wizard (or if it was skipped), config is saved and never asked again.
  if (!configExists() && source === 'startup') {
    await runSetupWizard();
  }

  const config   = getConfig();
  const existing = loadState(sessionId);
  let state;

  if (source === 'resume' && existing.session_id === sessionId) {
    // Resuming same session — keep accumulated state, just update config values.
    state = Object.assign({}, existing, {
      session_budget:    config.session_budget,
      warn_threshold:    config.warn_threshold,
      critical_threshold: config.critical_threshold
    });
  } else if (source === 'compact') {
    // /compact used — keep token count (PostCompact will adjust it), reset warnings.
    state = Object.assign({}, existing, {
      session_budget:    config.session_budget,
      warn_threshold:    config.warn_threshold,
      critical_threshold: config.critical_threshold,
      warned_60:  false,
      warned_80:  false,
      warned_90:  false,
      warned_95:  false,
      compacted_at:    new Date().toISOString(),
      compacted_count: (existing.compacted_count || 0) + 1
    });
  } else {
    // startup or clear — archive previous session if it had activity, then reset.
    if (existing.session_id && existing.call_count > 0) {
      try { archiveSession(existing); } catch (_) {}
    }
    state = Object.assign({}, DEFAULT_STATE, {
      session_id:         sessionId,
      session_budget:     config.session_budget,
      warn_threshold:     config.warn_threshold,
      critical_threshold: config.critical_threshold,
      started_at:         new Date().toISOString()
    });
    try { pruneOldSessions(); } catch (_) {}
  }

  try { saveState(sessionId, state); } catch (_) {}

  // Auto-register hooks in settings.json so they fire reliably for all users.
  // Plugin-registered hooks have a known bug in some Claude Code versions where
  // they don't fire during tool calls. Writing absolute paths to settings.json
  // bypasses this. We use CLAUDE_PLUGIN_ROOT (set by Claude Code when running
  // this hook) so the path is always correct for whoever installed the plugin.
  const registered = ensureHooksRegistered();

  // Output plain text — Claude Code adds non-JSON stdout to session context.
  let msg = buildContextMessage(state);
  if (registered) {
    msg += ' [Hooks registered — restart Claude Code once to activate full tracking.]';
  }
  process.stdout.write(msg + '\n');
}

// ── Auto-register hooks in settings.json ─────────────────────────────────────
// Returns true if settings.json was updated (user needs to restart), false if
// hooks were already up to date.

function ensureHooksRegistered() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return false; // Not running inside Claude Code

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const trackCostPath = path.join(pluginRoot, 'scripts', 'track-cost.js');

  // Read current settings
  let settings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (_) { return false; }

  // Check if PreToolUse hook already points to this exact plugin version
  const existingHooks = settings.hooks || {};
  const alreadyCurrent = (existingHooks.PreToolUse || []).some(h =>
    h.hooks && h.hooks.some(hh =>
      Array.isArray(hh.args) && hh.args[0] === trackCostPath
    )
  );
  if (alreadyCurrent) return false; // Already up to date

  // Build complete hooks config using absolute paths from CLAUDE_PLUGIN_ROOT
  const budgetHooks = {
    SessionStart: [{ hooks: [{
      type: 'command', command: 'node',
      args: [path.join(pluginRoot, 'scripts', 'session-init.js')],
      statusMessage: 'Budget Guard initialising…'
    }]}],
    UserPromptSubmit: [{ hooks: [{
      type: 'command', command: 'node',
      args: [path.join(pluginRoot, 'scripts', 'track-user-prompt.js')]
    }]}],
    PreToolUse: [{ matcher: '*', hooks: [{
      type: 'command', command: 'node',
      args: [trackCostPath]
    }]}],
    PostToolUse: [{ matcher: '*', hooks: [{
      type: 'command', command: 'node',
      args: [path.join(pluginRoot, 'scripts', 'track-post-tool.js')]
    }]}],
    Stop: [{ hooks: [{
      type: 'command', command: 'node',
      args: [path.join(pluginRoot, 'scripts', 'stop-hook.js')]
    }]}],
    PostCompact: [{ hooks: [{
      type: 'command', command: 'node',
      args: [path.join(pluginRoot, 'scripts', 'post-compact.js')],
      statusMessage: 'Budget Guard updating after compaction…'
    }]}]
  };

  // Merge: strip any old budget-guard hooks, then add fresh ones
  const merged = {};
  for (const [event, list] of Object.entries(existingHooks)) {
    const filtered = list.filter(h =>
      !h.hooks || !h.hooks.some(hh =>
        Array.isArray(hh.args) && typeof hh.args[0] === 'string' &&
        hh.args[0].includes('budget-guard')
      )
    );
    if (filtered.length > 0) merged[event] = filtered;
  }
  for (const [event, list] of Object.entries(budgetHooks)) {
    merged[event] = [...(merged[event] || []), ...list];
  }

  settings.hooks = merged;

  // Atomic write
  const tmp = settingsPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, settingsPath);
    return true; // Hooks were updated — user needs one restart
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

// ── Interactive setup wizard ──────────────────────────────────────────────────

async function runSetupWizard() {
  // Open the terminal device directly so prompts appear even though stdin is
  // already connected to the hook event JSON.  Falls back gracefully on any
  // platform where /dev/tty / CONIN$ isn't accessible (CI, pipes, etc.).
  const ttyIn  = openTTYInput();
  const ttyOut = openTTYOutput();

  if (!ttyIn || !ttyOut) {
    // Non-interactive environment — save defaults silently and continue.
    saveConfig({ session_budget: 100000, warn_threshold: 60, critical_threshold: 85 });
    return;
  }

  try {
    await runWizard(ttyIn, ttyOut);
  } catch (_) {
    // Any error → save defaults and move on.
    saveConfig({ session_budget: 100000, warn_threshold: 60, critical_threshold: 85 });
  } finally {
    try { ttyIn.destroy();  } catch (_) {}
    try { ttyOut.destroy(); } catch (_) {}
  }
}

async function runWizard(ttyIn, ttyOut) {
  const write = (s) => new Promise(resolve => ttyOut.write(s, resolve));

  await write('\n');
  await write('┌─────────────────────────────────────────────┐\n');
  await write('│  Budget Guard — First-Run Setup             │\n');
  await write('│  Press Enter to accept the default value.   │\n');
  await write('└─────────────────────────────────────────────┘\n');
  await write('\n');
  await write('  Claude Pro ≈ 100,000 tokens/session\n');
  await write('  Claude Max ≈ 200,000 tokens/session\n');
  await write('\n');

  const rl = readline.createInterface({ input: ttyIn, output: ttyOut, terminal: true });
  const ask = (prompt) => new Promise((resolve) => {
    // 30-second timeout — if user doesn't answer, use the default.
    const timer = setTimeout(() => {
      write('\n  (no input — using default)\n').catch(() => {});
      resolve('');
    }, 30000);
    rl.question(prompt, (answer) => {
      clearTimeout(timer);
      resolve(answer.trim());
    });
  });

  const budgetRaw = await ask('  Session token budget [100000]: ');
  const warnRaw   = await ask('  Warning threshold %  [60]:     ');
  const critRaw   = await ask('  Critical threshold % [85]:     ');

  rl.close();

  const budget = parseInt(budgetRaw || '100000', 10);
  const warn   = parseInt(warnRaw   || '60',     10);
  const crit   = parseInt(critRaw   || '85',     10);

  // Validate — clamp to reasonable ranges.
  const config = {
    session_budget:     (isNaN(budget) || budget < 1000)  ? 100000 : budget,
    warn_threshold:     (isNaN(warn)   || warn   < 1 || warn  > 99) ? 60 : warn,
    critical_threshold: (isNaN(crit)   || crit   < 1 || crit  > 99) ? 85 : crit
  };

  saveConfig(config);

  await write('\n');
  await write(`  ✓ Saved: budget=${config.session_budget.toLocaleString('en-US')} tokens` +
              `  warn=${config.warn_threshold}%  critical=${config.critical_threshold}%\n`);
  await write('  To change later: set CLAUDE_BUDGET_GUARD_LIMIT / _WARN / _CRITICAL env vars,\n');
  await write('  or delete ' + require('./lib/state').CONFIG_FILE + ' to re-run this wizard.\n');
  await write('\n');
}

function openTTYInput() {
  try {
    // fs.openSync throws synchronously if the device isn't accessible,
    // which is what we need — createReadStream errors are async and can't
    // be caught with a plain try/catch.
    const ttyPath = process.platform === 'win32' ? '\\\\.\\CONIN$' : '/dev/tty';
    const fd = fs.openSync(ttyPath, fs.constants.O_RDONLY | fs.constants.O_NOCTTY);
    const stream = fs.createReadStream(null, { fd, autoClose: true });
    stream.on('error', () => {});   // swallow late errors
    return stream;
  } catch (_) { return null; }
}

function openTTYOutput() {
  try {
    const ttyPath = process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty';
    const fd = fs.openSync(ttyPath, fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
    const stream = fs.createWriteStream(null, { fd, autoClose: true });
    stream.on('error', () => {});
    return stream;
  } catch (_) { return null; }
}

// ── Context message ───────────────────────────────────────────────────────────

function buildContextMessage(state) {
  const budget = state.session_budget;
  const used   = state.total_tokens;
  const pct    = Math.round((used / budget) * 100);

  let msg = `[Budget Guard] Session budget: ~${fmt(budget)} tokens. `;
  if (used > 0) msg += `Used so far: ~${fmt(used)} tokens (${pct}%). `;
  if (state.compacted_count > 0) {
    msg += `Compacted ${state.compacted_count}x this session — warning flags reset. `;
  }
  msg += `Warnings fire at ${state.warn_threshold}% and ${state.critical_threshold}%. `;
  msg += `Run /budget-guard:budget for live breakdown.`;
  return msg;
}

function fmt(n) { return Number(n).toLocaleString('en-US'); }
