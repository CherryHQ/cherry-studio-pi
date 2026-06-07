import { describe, expect, it } from 'vitest'

import { assertZipEntryNamesWithin } from '../safeZipExtract'

describe('safeZipExtract', () => {
  const baseDir = '/tmp/cherry-studio-pi/preprocess/extract'

  it('allows normal nested zip entries', () => {
    expect(() =>
      assertZipEntryNamesWithin(['result.md', 'assets/image.png', './nested/summary.md', 'folder/'], baseDir)
    ).not.toThrow()
  })

  it.each(['../evil.txt', 'nested/../../evil.txt', '/tmp/evil.txt', 'C:\\temp\\evil.txt', 'nested\\evil.txt', ''])(
    'rejects unsafe zip entry %s',
    (entryName) => {
      expect(() => assertZipEntryNamesWithin([entryName], baseDir)).toThrow('Unsafe zip entry path')
    }
  )
})
