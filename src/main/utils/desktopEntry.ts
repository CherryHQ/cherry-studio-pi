/**
 * Quote a single Exec argument for a freedesktop .desktop file.
 *
 * Desktop entries do not use shell single-quote parsing. Arguments with spaces
 * must be wrapped in double quotes, with special characters escaped inside.
 */
export function quoteDesktopExecArg(value: string): string {
  return `"${value.replace(/["\\`$]/g, '\\$&')}"`
}
