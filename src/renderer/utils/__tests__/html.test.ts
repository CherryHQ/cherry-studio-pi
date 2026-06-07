import { describe, expect, it } from 'vitest'

import { escapeHtmlText, renderPlainTextCodeHtml, sanitizeHtml } from '../html'

describe('html utils', () => {
  it('escapes text for HTML contexts', () => {
    expect(escapeHtmlText(`<img src="x" onerror='alert(1)'>&`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;'
    )
  })

  it('sanitizes unsafe HTML while preserving safe markup', () => {
    expect(sanitizeHtml('<p>safe</p><script>alert(1)</script>')).toBe('<p>safe</p>')
  })

  it('renders plain text as escaped code HTML', () => {
    expect(renderPlainTextCodeHtml('<script>alert(1)</script>')).toBe(
      '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>'
    )
  })
})
