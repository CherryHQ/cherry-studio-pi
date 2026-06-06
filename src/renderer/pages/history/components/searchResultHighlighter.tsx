import type { ReactNode } from 'react'

export const buildHighlightedTextParts = (text: string, regex: RegExp | null): ReactNode[] => {
  if (!regex) return [text]

  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  const matcher = new RegExp(regex.source, flags)
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(text)) !== null) {
    const matchText = match[0]
    if (matchText.length === 0) {
      matcher.lastIndex += 1
      continue
    }

    const start = match.index
    const end = start + matchText.length
    if (start > cursor) {
      parts.push(text.slice(cursor, start))
    }
    parts.push(<mark key={`${start}-${end}-${parts.length}`}>{matchText}</mark>)
    cursor = end
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts.length > 0 ? parts : [text]
}
