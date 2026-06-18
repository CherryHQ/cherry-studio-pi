import fs from 'node:fs'
import path from 'node:path'

import { occupiedDirs } from '@shared/config/constant'

import { isPathInside, isPathInsideOrEqual } from './file/path'

export interface CopyActiveUserDataDirectoryInput {
  sourcePath: string
  targetPath: string
  currentUserDataPath: string
  installPath?: string
}

function resolveRequiredPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }

  return path.resolve(value)
}

function isSamePath(a: string, b: string): boolean {
  return isPathInsideOrEqual(a, b) && isPathInsideOrEqual(b, a)
}

export async function copyActiveUserDataDirectory({
  sourcePath,
  targetPath,
  currentUserDataPath,
  installPath
}: CopyActiveUserDataDirectoryInput): Promise<void> {
  const source = resolveRequiredPath(sourcePath, 'Source data path')
  const target = resolveRequiredPath(targetPath, 'Target data path')
  const current = resolveRequiredPath(currentUserDataPath, 'Current data path')

  if (!isSamePath(source, current)) {
    throw new Error('Only the active application data directory can be copied')
  }

  if (isSamePath(source, target)) {
    throw new Error('Source and target data paths must be different')
  }

  if (isPathInside(target, source)) {
    throw new Error('Target data path cannot be inside the current data directory')
  }

  if (isPathInside(source, target)) {
    throw new Error('Target data path cannot contain the current data directory')
  }

  if (installPath && isPathInsideOrEqual(target, installPath)) {
    throw new Error('Target data path cannot be inside the application install directory')
  }

  const skippedSourceRoots = occupiedDirs.map((dir) => path.resolve(source, dir))

  await fs.promises.cp(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => {
      const resolvedSource = path.resolve(src)
      return !skippedSourceRoots.some((dir) => isPathInsideOrEqual(resolvedSource, dir))
    }
  })
}
