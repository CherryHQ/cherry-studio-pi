const MCP_LIST_SCROLL_STORAGE_KEY = 'mcp-list-scroll'

export function readMcpListScrollTop(): number | null {
  if (typeof sessionStorage === 'undefined') {
    return null
  }

  try {
    const savedScroll = sessionStorage.getItem(MCP_LIST_SCROLL_STORAGE_KEY)
    if (!savedScroll) return null

    const scrollTop = Number(savedScroll)
    return Number.isFinite(scrollTop) ? scrollTop : null
  } catch {
    return null
  }
}

export function writeMcpListScrollTop(scrollTop: number): void {
  if (typeof sessionStorage === 'undefined') {
    return
  }

  try {
    sessionStorage.setItem(MCP_LIST_SCROLL_STORAGE_KEY, String(scrollTop))
  } catch {
    // Scroll restoration is an enhancement. Storage failures should not break settings.
  }
}
