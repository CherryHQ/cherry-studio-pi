import { describe, expect, it } from 'vitest'

import { TRACER_NAME } from '../constants'

describe('observability constants', () => {
  it('uses the Cherry Studio Pi tracer identity', () => {
    expect(TRACER_NAME).toBe('CherryStudioPi')
  })
})
