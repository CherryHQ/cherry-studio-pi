import { describe, expect, it } from 'vitest'

import { buildDiscordUserAgent } from '../discord/userAgent'

describe('Discord user agent', () => {
  it('uses the Cherry Studio Pi repository and current app version', () => {
    expect(buildDiscordUserAgent('9.8.7')).toBe('DiscordBot (https://github.com/CherryHQ/cherry-studio-pi, 9.8.7)')
  })
})
