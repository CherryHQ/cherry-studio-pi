import { describe, expect, it } from 'vitest'

import { normalizeRuntimeTranslationValue, stripPendingTranslationPrefix } from '../index'
import viVN from '../translate/vi-vn.json'

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

describe('normalizeRuntimeTranslationValue', () => {
  it('keeps translated resources aligned with the Cherry Studio Pi brand', () => {
    expect(normalizeRuntimeTranslationValue('Welcome to Cherry Studio')).toBe('Welcome to Cherry Studio Pi')
    expect(normalizeRuntimeTranslationValue('Launch CherryStudio.exe')).toBe('Launch CherryStudioPi.exe')
    expect(normalizeRuntimeTranslationValue('Welcome to Cherry Studio Pi')).toBe('Welcome to Cherry Studio Pi')
  })

  it('normalizes stale branding in machine translated resources', () => {
    const text = JSON.stringify(normalizeRuntimeTranslationValue(viVN))

    expect(text).toContain('Cherry Studio Pi')
    expect(text).not.toMatch(/Cherry Studio(?! Pi)/)
    expect(text).not.toMatch(/CherryStudio(?!Pi)/)
  })
})
