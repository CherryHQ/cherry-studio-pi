import { describe, expect, it } from 'vitest'

import { enUS, zhCN } from '../locales'

describe('migration window locales', () => {
  it('uses Cherry Studio Pi in user-facing migration copy', () => {
    const text = JSON.stringify({ enUS, zhCN })

    expect(text).toContain('Cherry Studio Pi')
    expect(text).not.toMatch(/Cherry Studio(?! Pi)/)
  })
})
