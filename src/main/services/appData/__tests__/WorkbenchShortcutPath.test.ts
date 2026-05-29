import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dataRoot: '/mock/current/Data'
}))

vi.mock('@main/utils', () => ({
  getDataPath: (subPath?: string) => path.join(mocks.dataRoot, subPath ?? '')
}))

import { resolveRuntimeWorkbenchShortcut } from '../WorkbenchShortcutPath'

describe('resolveRuntimeWorkbenchShortcut', () => {
  it('rewrites restored HTML artifact shortcuts to the current data root', () => {
    const oldPath = '/old/Cherry Studio Pi/Data/Workbench/Artifact-12345678.html'

    expect(
      resolveRuntimeWorkbenchShortcut({
        id: 'artifact',
        kind: 'html',
        name: 'Artifact',
        url: pathToFileURL(oldPath).toString(),
        sourcePath: oldPath,
        metadata: { installedFrom: 'agent-html-artifact' }
      })
    ).toEqual(
      expect.objectContaining({
        url: pathToFileURL('/mock/current/Data/Workbench/Artifact-12345678.html').toString(),
        sourcePath: '/mock/current/Data/Workbench/Artifact-12345678.html'
      })
    )
  })

  it('derives the artifact filename from a file URL when sourcePath is missing', () => {
    const oldPath = '/old/Data/Workbench/Artifact-from-url.html'

    expect(
      resolveRuntimeWorkbenchShortcut({
        id: 'artifact',
        kind: 'html',
        name: 'Artifact',
        url: pathToFileURL(oldPath).toString(),
        sourcePath: null,
        metadata: { installedFrom: 'agent-html-artifact' }
      }).sourcePath
    ).toBe('/mock/current/Data/Workbench/Artifact-from-url.html')
  })

  it('does not rewrite normal URL shortcuts', () => {
    const shortcut = {
      id: 'docs',
      kind: 'url',
      name: 'Docs',
      url: 'https://docs.example.com',
      sourcePath: null
    }

    expect(resolveRuntimeWorkbenchShortcut(shortcut)).toBe(shortcut)
  })
})
