const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z\d+.-]*:\/\/)([^/@\s;,]+)@/gi
const PROXY_RULE_CREDENTIALS_PATTERN = /(^|[;\s,])((?:https?|socks4|socks5|ftp)=)([^/@\s;,]+)@/gi

export function redactProxyValueForLog(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''

  return String(value)
    .replace(URL_CREDENTIALS_PATTERN, '$1<redacted>@')
    .replace(PROXY_RULE_CREDENTIALS_PATTERN, '$1$2<redacted>@')
}
