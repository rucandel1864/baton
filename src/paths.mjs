// Path math and config-dir discovery. Zero dependencies.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function home() {
  return os.homedir();
}

export function batonDir() {
  return process.env.BATON_DIR || path.join(home(), '.baton');
}

export function codexHome() {
  return process.env.CODEX_HOME || path.join(home(), '.codex');
}

// OpenCode stores conversations in a SQLite DB under its data dir; custom
// commands live under its config dir. OpenCode uses XDG-style locations on
// every platform (including Windows/macOS), honoring XDG_* when set.
export function opencodeDb() {
  if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
  const candidates = [];
  if (process.env.XDG_DATA_HOME) candidates.push(path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db'));
  candidates.push(path.join(home(), '.local', 'share', 'opencode', 'opencode.db'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* unreadable candidate */
    }
  }
  return candidates[candidates.length - 1];
}
export function opencodeConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'opencode');
  return path.join(home(), '.config', 'opencode');
}

// Claude Code encodes a project dir by replacing every non-alphanumeric char
// with '-'. e.g. C:\Users\alice\Desktop\myproject
//            ->  C--Users-alice-Desktop-myproject
// (We derive `project` from the transcript's `cwd` field, not by reversing
//  this — but keep it correct for any forward lookups.)
export function sanitizeCwd(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

// Normalize an absolute path for equality comparison (case-insensitive on
// Windows, separator-insensitive, no trailing separator).
export function normPath(p) {
  if (!p) return '';
  let s = path.resolve(String(p));
  s = s.replace(/[\\/]+$/, '');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s;
}

export function samePath(a, b) {
  if (!a || !b) return false;
  return normPath(a) === normPath(b);
}

// True if a and b are the same path OR one is inside the other. Lets a pickup
// from a project subdirectory match a conversation rooted at the project (and
// vice-versa), so cwd drift within one project still resolves.
export function pathRelated(a, b) {
  if (!a || !b) return false;
  const na = normPath(a);
  const nb = normPath(b);
  if (na === nb) return true;
  return na.startsWith(nb + path.sep) || nb.startsWith(na + path.sep);
}

// Discover Claude Code config dirs to install into / read from.
// Looks at $CLAUDE_CONFIG_DIR, ~/.claude, and any ~/.claude-* sibling — people
// who run multiple accounts isolate them in suffixed config dirs, and Baton's
// whole point is handing off between those.
//
// Trust levels: $CLAUDE_CONFIG_DIR and ~/.claude are accepted on weak evidence
// (settings.json is enough — a fresh config dir may have nothing else). Scanned
// ~/.claude-* siblings need STRONG evidence (projects/ or commands/), because
// other tools also use .claude-<name> dirs for their own data and writing a
// hook into their settings.json would corrupt them.
export function discoverCcRoots() {
  const candidates = []; // { dir, strong }
  if (process.env.CLAUDE_CONFIG_DIR) candidates.push({ dir: process.env.CLAUDE_CONFIG_DIR, strong: false });
  candidates.push({ dir: path.join(home(), '.claude'), strong: false });
  try {
    for (const entry of fs.readdirSync(home())) {
      if (/^\.claude-[A-Za-z0-9_-]+$/.test(entry)) candidates.push({ dir: path.join(home(), entry), strong: true });
    }
  } catch {
    /* home not listable — fall back to the fixed candidates */
  }
  const roots = [];
  for (const { dir: c, strong } of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const hasStrong = fs.existsSync(path.join(c, 'projects')) || fs.existsSync(path.join(c, 'commands'));
      const looksLikeCc = strong ? hasStrong : hasStrong || fs.existsSync(path.join(c, 'settings.json'));
      if (looksLikeCc) {
        const np = normPath(c);
        if (!roots.some((r) => normPath(r) === np)) roots.push(c);
      }
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return roots;
}
