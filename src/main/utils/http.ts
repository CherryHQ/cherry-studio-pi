export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://github.com/CherryHQ/cherry-studio-pi',
    'X-Title': 'Cherry Studio Pi'
  }
}

/**
 * Checks whether a string is a valid HTTP(S) URL.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}
