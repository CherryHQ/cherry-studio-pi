import fsp from 'node:fs/promises'
import path from 'node:path'

import { getErrorMessage } from '@main/utils/errorMessage'

export type LegacyProjectionArchiveCleanupOptions = {
  prefixes: readonly string[]
  keepLatest?: number
  protectedPaths?: readonly (string | null | undefined)[]
}

export type LegacyProjectionArchiveCleanupReport = {
  legacyRoot: string
  removed: string[]
  kept: string[]
  failed: Array<{ path: string; error: string }>
}

const DEFAULT_LEGACY_PROJECTION_ARCHIVE_RETENTION = 10

function normalizeKeepLatest(value: number | undefined) {
  if (value === undefined) return DEFAULT_LEGACY_PROJECTION_ARCHIVE_RETENTION
  if (!Number.isFinite(value)) return DEFAULT_LEGACY_PROJECTION_ARCHIVE_RETENTION
  return Math.max(0, Math.floor(value))
}

export async function pruneManagedLegacyProjectionArchives(
  dataRoot: string,
  options: LegacyProjectionArchiveCleanupOptions
): Promise<LegacyProjectionArchiveCleanupReport> {
  const legacyRoot = path.join(dataRoot, 'legacy')
  const keepLatest = normalizeKeepLatest(options.keepLatest)
  const prefixes = Array.from(new Set(options.prefixes.filter(Boolean)))
  const protectedPaths = new Set(
    (options.protectedPaths ?? [])
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value))
  )
  const report: LegacyProjectionArchiveCleanupReport = {
    legacyRoot,
    removed: [],
    kept: [],
    failed: []
  }

  if (prefixes.length === 0) return report

  let entries
  try {
    entries = await fsp.readdir(legacyRoot, { withFileTypes: true })
  } catch (error: any) {
    if (error?.code === 'ENOENT') return report
    throw error
  }

  for (const prefix of prefixes) {
    const candidates = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
          .map(async (entry) => {
            const archivePath = path.resolve(legacyRoot, entry.name)
            const stat = await fsp.stat(archivePath).catch(() => null)
            if (!stat?.isDirectory()) return null
            return {
              path: archivePath,
              mtimeMs: stat.mtimeMs
            }
          })
      )
    ).filter((item): item is { path: string; mtimeMs: number } => Boolean(item))

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path))

    for (const [index, candidate] of candidates.entries()) {
      if (index < keepLatest || protectedPaths.has(candidate.path)) {
        report.kept.push(candidate.path)
        continue
      }

      try {
        await fsp.rm(candidate.path, { recursive: true, force: true })
        report.removed.push(candidate.path)
      } catch (error) {
        report.failed.push({
          path: candidate.path,
          error: getErrorMessage(error, 'Unknown legacy archive cleanup error')
        })
      }
    }
  }

  return report
}
