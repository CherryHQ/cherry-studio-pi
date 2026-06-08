/**
 * External URL safety rules shared by preload and main processes.
 */

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'obsidian:',
  'x-apple.systempreferences:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'zed:'
])

/**
 * Editor deep-link schemes. For these we only accept the "open a file" shape
 * produced by `buildEditorUrl()`, so attacker-supplied links cannot reach other
 * authorities such as `vscode://command/...` or extension URL handlers.
 */
const EDITOR_DEEP_LINK_PROTOCOLS = new Set(['vscode:', 'vscode-insiders:', 'cursor:', 'zed:'])

/**
 * Zed's deep-link format is `zed://file<path>` (no slash separator before the
 * path). On Unix the URL is `zed://file/abs/path`; on Windows a path like
 * C:\Users\foo\bar.ts becomes `zed://fileC%3A/...`.
 */
const ZED_FILE_URL_RE = /^zed:\/\/file(\/|[A-Za-z]%3[Aa]\/)/i

/**
 * Check whether a URL is safe to open via Electron shell.openExternal().
 *
 * Only an explicit allowlist of schemes is permitted. Editor schemes are
 * further restricted to the file-open URL shape emitted by `buildEditorUrl()`
 * so attacker-supplied links cannot invoke editor commands or extension
 * protocol handlers.
 *
 * @see https://benjamin-altpeter.de/shell-openexternal-dangers/
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false
    }
    if (parsed.username !== '' || parsed.password !== '') {
      return false
    }
    if (EDITOR_DEEP_LINK_PROTOCOLS.has(parsed.protocol)) {
      return isFileOpenEditorUrl(parsed, url)
    }
    return true
  } catch {
    return false
  }
}

function isFileOpenEditorUrl(parsed: URL, rawUrl: string): boolean {
  if (parsed.protocol === 'zed:') {
    return ZED_FILE_URL_RE.test(rawUrl)
  }
  return parsed.host === 'file'
}
