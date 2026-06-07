import DOMPurify from 'dompurify'

export const escapeHtmlText = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })

export const sanitizeHtml = (value: string): string => DOMPurify.sanitize(value)

export const renderPlainTextCodeHtml = (value: string): string => `<pre><code>${escapeHtmlText(value)}</code></pre>`
