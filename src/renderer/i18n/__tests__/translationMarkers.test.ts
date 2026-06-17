import { describe, expect, it } from 'vitest'

import { stripPendingTranslationPrefix } from '../index'

describe('stripPendingTranslationPrefix', () => {
  it('hides pending translation markers from runtime copy', () => {
    expect(stripPendingTranslationPrefix('[to be translated]:Close Tab')).toBe('Close Tab')
    expect(stripPendingTranslationPrefix('[to be translated]Close Tab')).toBe('Close Tab')
    expect(stripPendingTranslationPrefix('Close Tab')).toBe('Close Tab')
  })

  it('cleans nested translation resource values', () => {
    const resource = {
      tabs: {
        close: '[to be translated]:Close Tab',
        actions: ['Pin Tab', '[to be translated]:Move Tab to First']
      },
      count: 1
    }

    expect(stripPendingTranslationPrefix(resource)).toEqual({
      tabs: {
        close: 'Close Tab',
        actions: ['Pin Tab', 'Move Tab to First']
      },
      count: 1
    })
  })
})
