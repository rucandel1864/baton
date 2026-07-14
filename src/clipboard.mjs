// Cross-platform clipboard copy with zero dependencies: spawn the OS's own
// clipboard tool. This is what makes Baton tool-agnostic — any AI tool with a
// paste box (web chats included) can receive a handoff via `baton copy`.
import { spawnSync } from 'node:child_process';

function trySpawn(cmd, args, input) {
  try {
    const r = spawnSync(cmd, args, { input, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

// Returns { ok, method } — never throws.
export function copyToClipboard(text) {
  const s = String(text);
  if (process.platform === 'win32') {
    // PowerShell Set-Clipboard with explicit UTF-8 stdin: correct Unicode and,
    // unlike `clip.exe` (which needs a UTF-16 BOM that then leaks into the
    // pasted text), leaves no BOM behind.
    const ps = '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())';
    if (trySpawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], Buffer.from(s, 'utf8'))) {
      return { ok: true, method: 'powershell Set-Clipboard' };
    }
    // Fallback: clip.exe with a UTF-16LE BOM (BOM may appear at paste time).
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
    if (trySpawn('clip', [], utf16)) return { ok: true, method: 'clip' };
    return { ok: false };
  }
  if (process.platform === 'darwin') {
    if (trySpawn('pbcopy', [], s)) return { ok: true, method: 'pbcopy' };
    return { ok: false };
  }
  // Linux/BSD: Wayland first, then X11 helpers.
  if (trySpawn('wl-copy', [], s)) return { ok: true, method: 'wl-copy' };
  if (trySpawn('xclip', ['-selection', 'clipboard'], s)) return { ok: true, method: 'xclip' };
  if (trySpawn('xsel', ['--clipboard', '--input'], s)) return { ok: true, method: 'xsel' };
  return { ok: false };
}
