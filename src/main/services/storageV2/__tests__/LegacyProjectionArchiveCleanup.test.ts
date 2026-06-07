import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pruneManagedLegacyProjectionArchives } from '../LegacyProjectionArchiveCleanup'

describe('pruneManagedLegacyProjectionArchives', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'legacy-projection-cleanup-'))
  })

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  async function createLegacyDir(name: string, mtimeMs: number) {
    const dir = path.join(tempRoot, 'legacy', name)
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'archive.txt'), name)
    const time = new Date(mtimeMs)
    await fsp.utimes(dir, time, time)
    return dir
  }

  async function exists(target: string) {
    return Boolean(await fsp.stat(target).catch(() => null))
  }

  it('removes only old managed projection archives and keeps unrelated directories', async () => {
    const oldest = await createLegacyDir('data-sync-runtime-projection-1000', 1000)
    const middle = await createLegacyDir('data-sync-runtime-projection-2000', 2000)
    const newest = await createLegacyDir('data-sync-runtime-projection-3000', 3000)
    const unrelated = await createLegacyDir('user-backup-1000', 500)

    const report = await pruneManagedLegacyProjectionArchives(tempRoot, {
      prefixes: ['data-sync-runtime-projection-'],
      keepLatest: 2
    })

    expect(report.removed).toEqual([oldest])
    await expect(exists(oldest)).resolves.toBe(false)
    await expect(exists(middle)).resolves.toBe(true)
    await expect(exists(newest)).resolves.toBe(true)
    await expect(exists(unrelated)).resolves.toBe(true)
  })

  it('honors protected paths even when they are older than the retention window', async () => {
    const protectedOld = await createLegacyDir('agent-projection-2026-01-01', 1000)
    const newer = await createLegacyDir('agent-projection-2026-01-02', 2000)

    const report = await pruneManagedLegacyProjectionArchives(tempRoot, {
      prefixes: ['agent-projection-'],
      keepLatest: 1,
      protectedPaths: [protectedOld]
    })

    expect(report.removed).toEqual([])
    await expect(exists(protectedOld)).resolves.toBe(true)
    await expect(exists(newer)).resolves.toBe(true)
  })
})
