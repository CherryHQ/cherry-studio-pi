import path from 'node:path'

import AdmZip from 'adm-zip'

export function assertZipEntryNamesWithin(entryNames: readonly string[], baseDir: string): void {
  const root = path.resolve(baseDir)

  for (const entryName of entryNames) {
    if (
      !entryName ||
      path.posix.isAbsolute(entryName) ||
      path.win32.isAbsolute(entryName) ||
      entryName.includes('\\')
    ) {
      throw new Error(`Unsafe zip entry path: ${entryName}`)
    }

    const normalizedName = path.posix.normalize(entryName)
    if (!normalizedName || normalizedName === '.' || normalizedName === '..' || normalizedName.startsWith('../')) {
      throw new Error(`Unsafe zip entry path: ${entryName}`)
    }

    const target = path.resolve(baseDir, normalizedName)
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Unsafe zip entry path: ${entryName}`)
    }
  }
}

export function extractAdmZipSafely(zipPath: string, extractPath: string, overwrite = true): void {
  const zip = new AdmZip(zipPath)
  assertZipEntryNamesWithin(
    zip.getEntries().map((entry) => entry.entryName),
    extractPath
  )
  zip.extractAllTo(extractPath, overwrite)
}
