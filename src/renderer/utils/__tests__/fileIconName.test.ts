import { describe, expect, it } from 'vitest'

import { getFileIconName } from '../fileIconName'

describe('fileIconName', () => {
  it('matches exact filenames from Unix paths', () => {
    expect(getFileIconName('/tmp/project/package.json')).toBe('nodejs')
  })

  it('matches exact filenames from Windows paths', () => {
    expect(getFileIconName('C:\\Users\\Cherry\\project\\package.json')).toBe('nodejs')
  })

  it('matches compound extensions from Windows paths', () => {
    expect(getFileIconName('C:\\Users\\Cherry\\project\\types.d.ts')).toBe('typescript-def')
  })
})
