import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findAllSkillDirectories, parsePluginMetadata, parseSkillMetadata } from '../markdownParser'

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
    realpath: vi.fn()
  }
}))

vi.mock('../fileOperations', () => ({
  getDirectorySize: vi.fn().mockResolvedValue(123)
}))

describe('markdownParser', () => {
  const pluginContent = `---
name: bad-plugin
description: Use this agent when example: user: "hi"
tools: ["Read", "Grep"]
---

Body`

  const skillContent = `---
name: bad-skill
description: Use this skill when example: user: "hi"
tools: Read, Grep
---

Body`

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 42 } as fs.Stats)
    vi.mocked(fs.promises.readdir).mockResolvedValue([])
    vi.mocked(fs.promises.realpath).mockImplementation(async (targetPath) => String(targetPath))
    vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
      if (String(filePath).includes('SKILL.md')) {
        return skillContent
      }
      return pluginContent
    })
  })

  it('recovers invalid plugin frontmatter and keeps metadata', async () => {
    const metadata = await parsePluginMetadata('/abs/plugin.md', 'plugins/plugin.md', 'plugins', 'agent')
    expect(metadata.name).toBe('bad-plugin')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('recovers invalid skill frontmatter and keeps metadata', async () => {
    const metadata = await parseSkillMetadata('/abs/skill', 'skills/bad-skill', 'skills')
    expect(metadata.name).toBe('bad-skill')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('follows symlinked skill directories only when they stay under the search root', async () => {
    const basePath = '/repo'
    vi.mocked(fs.promises.stat).mockImplementation(async (targetPath) => {
      const value = String(targetPath)
      if (value === '/repo/SKILL.md' || value === '/repo/skill.md') {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      if (value === '/repo/internal-link' || value === '/repo/external-link') {
        return { isDirectory: () => true } as fs.Stats
      }
      if (value === '/repo/internal-link/SKILL.md') {
        return { isDirectory: () => false, size: 42 } as fs.Stats
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
      { name: 'internal-link', isDirectory: () => false, isSymbolicLink: () => true },
      { name: 'external-link', isDirectory: () => false, isSymbolicLink: () => true }
    ] as any)
    vi.mocked(fs.promises.realpath).mockImplementation(async (targetPath) => {
      if (String(targetPath) === '/repo/internal-link') return '/repo/shared/internal'
      if (String(targetPath) === '/repo/external-link') return '/outside/external'
      return String(targetPath)
    })

    const result = await findAllSkillDirectories(basePath, basePath)

    expect(result).toEqual([{ folderPath: '/repo/internal-link', sourcePath: 'internal-link' }])
    expect(fs.promises.readdir).toHaveBeenCalledTimes(1)
  })
})
