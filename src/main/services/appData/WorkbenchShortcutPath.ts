import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getDataPath } from '@main/utils'

type WorkbenchShortcutLike = Record<string, any> & {
  filePath?: string | null
  kind?: string | null
  metadata?: Record<string, unknown> | null
  sourcePath?: string | null
  url?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sourcePathFromFileUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null

  try {
    return fileURLToPath(url)
  } catch {
    return null
  }
}

function getShortcutSourcePath(shortcut: WorkbenchShortcutLike): string | null {
  return (
    (typeof shortcut.sourcePath === 'string' && shortcut.sourcePath) ||
    (typeof shortcut.filePath === 'string' && shortcut.filePath) ||
    sourcePathFromFileUrl(shortcut.url)
  )
}

function shouldRewriteHtmlArtifact(shortcut: WorkbenchShortcutLike, sourcePath: string): boolean {
  if (shortcut.kind !== 'html') return false

  const metadata = isRecord(shortcut.metadata) ? shortcut.metadata : null
  return metadata?.installedFrom === 'agent-html-artifact' || path.extname(sourcePath).toLowerCase() === '.html'
}

export function resolveRuntimeWorkbenchShortcut<T extends WorkbenchShortcutLike>(shortcut: T): T {
  const sourcePath = getShortcutSourcePath(shortcut)
  if (!sourcePath || !shouldRewriteHtmlArtifact(shortcut, sourcePath)) return shortcut

  const runtimePath = path.join(getDataPath('Workbench'), path.basename(sourcePath))
  const nextShortcut = {
    ...shortcut,
    sourcePath: runtimePath,
    url: pathToFileURL(runtimePath).toString()
  }

  if (typeof shortcut.filePath === 'string') {
    nextShortcut.filePath = runtimePath
  }

  return nextShortcut
}
