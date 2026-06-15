import { describe, expect, it } from 'vitest'

import { buildSkillMarketplaceUserAgent } from '../skillMarketplaceIdentity'

describe('skill marketplace identity', () => {
  it('uses the Cherry Studio Pi compact app name and version', () => {
    expect(buildSkillMarketplaceUserAgent('9.8.7')).toBe('CherryStudioPi/9.8.7')
  })
})
