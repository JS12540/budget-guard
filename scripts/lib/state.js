'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ${CLAUDE_PLUGIN_DATA} is set by Claude Code to a persistent, update-safe directory.
// Falls back to a sensible default if run outside Claude Code (e.g. during development).
const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA ||
  path.join(os.homedir(), '.claude', 'plugins', 'data', 'budget-guard');

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'config.json');

const DEFAULT_STATE = {
  session_id: null,
  session_budget: 100000,
  warn_threshold: 60,
  critical_threshold: 85,
  total_tokens: 0,
  call_count: 0,
  // One flag per tier so each warning fires exactly once per session.
  warned_60: false,
  warned_80: false,
  warned_90: false,
  warned_95: false,
  started_at: null,
  compacted_at: null,
  compacted_count: 0,
  breakdown: {
    file_ops: 0,
    bash: 0,
    mcp: 0,
    search: 0,
    agent: 0,
    other: 0
  }
};

function ensureDirs() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionFile(sessionId) {
  // Sanitise the session ID so it is safe as a filename on all platforms.
  const safe = (sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(SESSIONS_DIR, safe + '.json');
}

function loadState(sessionId) {
  ensureDirs();
  const file = sessionFile(sessionId);
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      return Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
    }
  } catch (_) {
    // Corrupt state — return default rather than crashing.
  }
  return Object.assign({}, DEFAULT_STATE);
}

function saveState(sessionId, state) {
  ensureDirs();
  const file = sessionFile(sessionId);
  // Atomic write: write to a pid-unique temp file, then rename.
  const tmp = file + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveHistory(history) {
  ensureDirs();
  const trimmed = history.slice(-50); // keep last 50 sessions
  const tmp = HISTORY_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (_) {}
}

function archiveSession(state) {
  if (!state.session_id || state.call_count === 0) return;
  const history = loadHistory();
  history.push({
    session_id: state.session_id,
    total_tokens: state.total_tokens,
    session_budget: state.session_budget,
    call_count: state.call_count,
    pct_used: Math.round((state.total_tokens / state.session_budget) * 100),
    started_at: state.started_at,
    ended_at: new Date().toISOString(),
    breakdown: Object.assign({}, state.breakdown)
  });
  saveHistory(history);
}

function pruneOldSessions() {
  // Remove session files older than 7 days to avoid unbounded disk growth.
  try {
    ensureDirs();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(SESSIONS_DIR, f);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (_) {}
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Config file — written once by the first-run setup wizard in session-init.js.
// Priority: env vars > userConfig dialog values > config file > hardcoded defaults.
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function saveConfig(config) {
  ensureDirs();
  const tmp = CONFIG_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (_) {}
}

function configExists() {
  return fs.existsSync(CONFIG_FILE);
}

function getConfig() {
  const saved = loadConfig() || {};
  return {
    // Priority: env var > userConfig plugin option > saved config file > hardcoded default.
    session_budget: parseInt(
      process.env.CLAUDE_BUDGET_GUARD_LIMIT ||
      process.env.CLAUDE_PLUGIN_OPTION_SESSION_BUDGET ||
      saved.session_budget ||
      '100000',
      10
    ),
    warn_threshold: parseInt(
      process.env.CLAUDE_BUDGET_GUARD_WARN ||
      process.env.CLAUDE_PLUGIN_OPTION_WARN_THRESHOLD ||
      saved.warn_threshold ||
      '60',
      10
    ),
    critical_threshold: parseInt(
      process.env.CLAUDE_BUDGET_GUARD_CRITICAL ||
      process.env.CLAUDE_PLUGIN_OPTION_CRITICAL_THRESHOLD ||
      saved.critical_threshold ||
      '85',
      10
    )
  };
}

module.exports = {
  DATA_DIR,
  CONFIG_FILE,
  SESSIONS_DIR,
  DEFAULT_STATE,
  loadState,
  saveState,
  loadHistory,
  saveHistory,
  archiveSession,
  pruneOldSessions,
  loadConfig,
  saveConfig,
  configExists,
  getConfig
};
