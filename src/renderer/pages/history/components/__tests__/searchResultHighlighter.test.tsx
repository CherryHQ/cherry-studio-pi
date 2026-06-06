import { buildKeywordUnionRegex } from '@renderer/utils/keywordSearch'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildHighlightedTextParts } from '../searchResultHighlighter'

const renderHighlightedText = (text: string, regex: RegExp | null) => {
  render(<span data-testid="result">{buildHighlightedTextParts(text, regex)}</span>)
  return screen.getByTestId('result')
}

describe('searchResultHighlighter', () => {
  it('renders HTML-looking content as text while highlighting matches', () => {
    const regex = buildKeywordUnionRegex(['script'], { matchMode: 'substring', flags: 'gi' })
    const result = renderHighlightedText('hello <script>alert(1)</script>', regex)

    expect(result.textContent).toBe('hello <script>alert(1)</script>')
    expect(result.querySelector('script')).toBeNull()
    expect(result.querySelectorAll('mark')).toHaveLength(2)
  })

  it('does not leak global regex state between calls', () => {
    const regex = /foo/gi

    void buildHighlightedTextParts('foo foo', regex)
    const result = renderHighlightedText('foo foo', regex)

    expect(result.querySelectorAll('mark')).toHaveLength(2)
  })
})
