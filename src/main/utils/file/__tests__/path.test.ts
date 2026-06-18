import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { canWrite, isNotEmptyDir, isPathInside, isUnderInternalStorage } from '../path'

describe('isPathInside', () => {
  it('returns true when child is directly inside parent', () => {
    expect(isPathInside('/foo/bar/baz.txt', '/foo/bar')).toBe(true)
  })

  it('returns true when child is nested deeper', () => {
    expect(isPathInside('/foo/bar/baz/qux.txt', '/foo/bar')).toBe(true)
  })

  it('returns false when child is parent itself', () => {
    expect(isPathInside('/foo/bar', '/foo/bar')).toBe(false)
  })

  it('returns false when child is sibling', () => {
    expect(isPathInside('/foo/bar', '/foo/baz')).toBe(false)
  })

  it('returns false when child is parent of parent', () => {
    expect(isPathInside('/foo', '/foo/bar')).toBe(false)
  })

  it('handles path traversal attempts ("../") correctly', () => {
    expect(isPathInside('/foo/bar/../baz', '/foo/bar')).toBe(false)
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'matches case-insensitively on darwin / win32 (filesystem default)',
    () => {
      // Regression guard: previously `path.relative` compared bytes
      // exactly, letting `/users/me/data/files/x` slip past a check
      // against `/Users/me/Data/Files` on a default macOS install.
      // `isUnderInternalStorage` derives from this and was bypassable
      // for any future Phase 2 caller using it as a permission gate.
      expect(isPathInside('/Users/me/Data/Files/x.txt', '/users/me/data/files')).toBe(true)
      expect(isPathInside('/USERS/ME/DATA/FILES/x.txt', '/users/me/data/files')).toBe(true)
    }
  )

  it.runIf(process.platform === 'linux')('stays case-sensitive on linux (filesystem default)', () => {
    // On case-sensitive POSIX filesystems `/Users` and `/users` are
    // genuinely different paths; the function MUST NOT collapse them.
    expect(isPathInside('/Users/me/Data/Files/x.txt', '/users/me/data/files')).toBe(false)
  })
})

describe('isUnderInternalStorage', () => {
  it('returns true for paths inside the feature.files.data dir', () => {
    expect(isUnderInternalStorage('/mock/feature.files.data/abc.png')).toBe(true)
  })

  it('returns false for paths outside the feature.files.data dir', () => {
    expect(isUnderInternalStorage('/etc/passwd')).toBe(false)
  })

  it('returns false for the feature.files.data dir itself (only strict descendants count)', () => {
    expect(isUnderInternalStorage('/mock/feature.files.data')).toBe(false)
  })
})

describe('canWrite', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-path-test-'))
  })

  afterEach(async () => {
    // Restore perms before deletion in case a test chmod-restricted the dir
    try {
      await chmod(tmp, 0o755)
    } catch {
      // ignore
    }
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns true for a freshly-created writable directory', async () => {
    expect(await canWrite(tmp as FilePath)).toBe(true)
  })

  it('returns false for a non-existent path', async () => {
    expect(await canWrite(path.join(tmp, 'nope', String(Date.now())) as FilePath)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('returns false for a chmod-stripped directory (POSIX)', async () => {
    await chmod(tmp, 0o500)
    expect(await canWrite(tmp as FilePath)).toBe(false)
  })
})

describe('isNotEmptyDir', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-not-empty-dir-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns false for an empty directory', async () => {
    expect(await isNotEmptyDir(tmp as FilePath)).toBe(false)
  })

  it('returns true for a directory with entries', async () => {
    await mkdir(path.join(tmp, 'nested'))
    expect(await isNotEmptyDir(tmp as FilePath)).toBe(true)
  })

  it('returns false for a missing directory', async () => {
    expect(await isNotEmptyDir(path.join(tmp, 'missing') as FilePath)).toBe(false)
  })

  it('fails closed for a file path', async () => {
    const filePath = path.join(tmp, 'not-a-directory')
    await writeFile(filePath, 'content')

    expect(await isNotEmptyDir(filePath as FilePath)).toBe(true)
  })
})
