import { describe, expect, it } from 'vitest'

import { parseTaskTimeoutMinutes, resolveTaskTimeoutBlur } from '../taskTimeoutGuards'

describe('task timeout guards', () => {
  it('parses only positive integer minute values', () => {
    expect(parseTaskTimeoutMinutes('15')).toBe(15)
    expect(parseTaskTimeoutMinutes('  30  ')).toBe(30)

    expect(parseTaskTimeoutMinutes('')).toBeNull()
    expect(parseTaskTimeoutMinutes('0')).toBeNull()
    expect(parseTaskTimeoutMinutes('-1')).toBeNull()
    expect(parseTaskTimeoutMinutes('1.5')).toBeNull()
    expect(parseTaskTimeoutMinutes('1e2')).toBeNull()
    expect(parseTaskTimeoutMinutes('1abc')).toBeNull()
    expect(parseTaskTimeoutMinutes('999999999999999999999999')).toBeNull()
  })

  it('resolves blur edits without saving invalid timeout values', () => {
    expect(resolveTaskTimeoutBlur('20', 10)).toEqual({ action: 'save', value: 20 })
    expect(resolveTaskTimeoutBlur('', 10)).toEqual({ action: 'reset', value: '10' })
    expect(resolveTaskTimeoutBlur('10', 10)).toEqual({ action: 'noop' })
    expect(resolveTaskTimeoutBlur('010', 10)).toEqual({ action: 'reset', value: '10' })
    expect(resolveTaskTimeoutBlur('abc', 10)).toEqual({ action: 'reset', value: '10' })
    expect(resolveTaskTimeoutBlur('abc', null)).toEqual({ action: 'reset', value: '' })
  })
})
