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
// commands live under its config dir.
export function opencodeDb() {
  if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
  return path.join(home(), '.local', 'share', 'opencode', 'opencode.db');
}
export function opencodeConfigDir() {
  return process.env.OPENCODE_CONFIG_DIR || path.join(home(), '.config', 'opencode');
}

// Claude Code encodes a project dir by replacing every non-alphanumeric char
// with '-'. e.g. C:\Users\sneak\OneDrive\Desktop\investing
//            ->  C--Users-sneak-OneDrive-Desktop-investing
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
// Looks at CLAUDE_CONFIG_DIR, ~/.claude, ~/.claude-b (dedup, existing only).
export function discoverCcRoots() {
  const candidates = [];
  if (process.env.CLAUDE_CONFIG_DIR) candidates.push(process.env.CLAUDE_CONFIG_DIR);
  candidates.push(path.join(home(), '.claude'));
  candidates.push(path.join(home(), '.claude-b'));
  const roots = [];
  for (const c of candidates) {
    try {
      const looksLikeCc =
        fs.existsSync(path.join(c, 'projects')) ||
        fs.existsSync(path.join(c, 'settings.json')) ||
        fs.existsSync(path.join(c, 'commands'));
      if (fs.existsSync(c) && looksLikeCc) {
        const np = normPath(c);
        if (!roots.some((r) => normPath(r) === np)) roots.push(c);
      }
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return roots;
}
