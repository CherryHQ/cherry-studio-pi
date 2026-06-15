import { describe, expect, it } from 'vitest'

import enUS from '../en-us.json'
import zhCN from '../zh-cn.json'
import zhTW from '../zh-tw.json'

describe('source locale branding', () => {
  it('uses Cherry Studio Pi in source locale user-facing copy', () => {
    const text = JSON.stringify({ enUS, zhCN, zhTW })

    expect(text).toContain('Cherry Studio Pi')
    expect(text).not.toMatch(/Cherry Studio(?! Pi)/)
    expect(text).not.toMatch(/CherryStudio(?!Pi)/)
    expect(text).not.toMatch(/cherry-studio(?!-pi)/)
  })
})
