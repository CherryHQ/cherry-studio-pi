import { describe, expect, it } from 'vitest'

import { getNewDataPathFromArgs } from '../launchArgs'

describe('getNewDataPathFromArgs', () => {
  it('returns the configured data path from launch arguments', () => {
    expect(getNewDataPathFromArgs(['/app', '--new-data-path=/Users/me/Data'])).toBe('/Users/me/Data')
  })

  it('preserves equals signs inside the data path', () => {
    expect(getNewDataPathFromArgs(['/app', '--new-data-path=/Users/me/Data=2026/Cherry=Pi'])).toBe(
      '/Users/me/Data=2026/Cherry=Pi'
    )
  })

  it('ignores missing and empty data path arguments', () => {
    expect(getNewDataPathFromArgs(['/app'])).toBeUndefined()
    expect(getNewDataPathFromArgs(['/app', '--new-data-path='])).toBeUndefined()
  })
})
