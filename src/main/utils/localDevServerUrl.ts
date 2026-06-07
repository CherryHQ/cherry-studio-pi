const LOCAL_DEV_SERVER_PORT_PREFIX = '517'

export function isLocalViteDevServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const isLoopbackHost =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'

    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLoopbackHost &&
      parsed.port.startsWith(LOCAL_DEV_SERVER_PORT_PREFIX)
    )
  } catch {
    return false
  }
}
