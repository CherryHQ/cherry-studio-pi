import fs from 'node:fs/promises'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesRoot: '',
  notifyDataSyncLocalChange: vi.fn(),
  preferenceService: {
    get: vi.fn()
  },
  isSupportedSettingPath: vi.fn(),
  persistSettingValue: vi.fn(),
  readSettingsForAgent: vi.fn(async () => ({}))
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return mocks.preferenceService
      if (name === 'WindowManager') return { getWindowsByType: vi.fn(() => []) }
      if (name === 'MainWindowService') return { showMainWindow: vi.fn() }
      throw new Error(`Unexpected service: ${name}`)
    })
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn()
    }))
  }
}))

vi.mock('@main/core/platform', () => ({
  isMac: false
}))

vi.mock('@main/core/window/types', () => ({
  WindowType: {
    Main: 'main'
  }
}))

vi.mock('@main/services/appCapabilities', () => ({
  appCapabilityService: {
    list: vi.fn(() => []),
    search: vi.fn(() => []),
    call: vi.fn()
  }
}))

vi.mock('@main/services/appCapabilities/providers/paintings', () => ({
  listPaintingHistory: vi.fn(() => ({ paintings: [] })),
  PAINTING_NAMESPACES: []
}))

vi.mock('@main/services/appCapabilities/providers/settings', () => ({
  isSupportedSettingPath: mocks.isSupportedSettingPath,
  persistSettingValue: mocks.persistSettingValue,
  readSettingsForAgent: mocks.readSettingsForAgent
}))

vi.mock('@main/services/appCapabilities/rendererBridge', () => ({
  readRendererStoreValue: vi.fn(async () => null)
}))

vi.mock('@main/services/appData/DataSyncLocalChangeNotifier', () => ({
  notifyMainProcessDataSyncLocalChange: mocks.notifyDataSyncLocalChange
}))

vi.mock('@main/utils/file', () => ({
  getName: (_parent: string, name: string) => String(name || 'Untitled').trim() || 'Untitled',
  getNotesDir: () => mocks.notesRoot,
  isPathInside: (childPath: string, parentPath: string) => {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
}))

import { appToolsRoutes } from '../app-tools'

async function requestAppTools(method: string, requestPath: string, body?: unknown) {
  const app = express()
  app.use(express.json())
  app.use(appToolsRoutes)

  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer))
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port')
    const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = await response.json()
    return { status: response.status, json }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe('app tools notes routes', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-app-tools-notes-'))
    mocks.notesRoot = tmpDir
    mocks.preferenceService.get.mockReset()
    mocks.preferenceService.get.mockImplementation((key: string) => {
      if (key === 'feature.notes.path') return tmpDir
      return undefined
    })
    mocks.notifyDataSyncLocalChange.mockReset()
    mocks.isSupportedSettingPath.mockReset()
    mocks.isSupportedSettingPath.mockReturnValue(false)
    mocks.persistSettingValue.mockReset()
    mocks.persistSettingValue.mockResolvedValue(undefined)
    mocks.readSettingsForAgent.mockReset()
    mocks.readSettingsForAgent.mockResolvedValue({})
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('rejects deleting the notes root directory', async () => {
    const rmSpy = vi.spyOn(fs, 'rm')
    try {
      const result = await requestAppTools('DELETE', '/notes?path=.')

      expect(result).toEqual({
        status: 400,
        json: { error: 'Cannot delete the notes root directory' }
      })
      expect(rmSpy).not.toHaveBeenCalled()
      await expect(fs.stat(tmpDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
      expect(mocks.notifyDataSyncLocalChange).not.toHaveBeenCalled()
    } finally {
      rmSpy.mockRestore()
    }
  })

  it('keeps deleting a note by extensionless path', async () => {
    const notePath = path.join(tmpDir, 'daily.md')
    await fs.writeFile(notePath, 'today\n', 'utf8')

    const result = await requestAppTools('DELETE', '/notes?path=daily')

    expect(result.status).toBe(200)
    expect(result.json).toEqual({ ok: true, path: notePath })
    await expect(fs.stat(notePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mocks.notifyDataSyncLocalChange).toHaveBeenCalledWith('file', {
      source: 'api.app-tools.notes.delete',
      path: notePath
    })
  })

  it('preserves non-string note content instead of silently blanking it', async () => {
    const notePath = path.join(tmpDir, 'structured.md')

    const created = await requestAppTools('POST', '/notes', {
      name: 'structured',
      content: { title: 'Morning', done: false }
    })

    expect(created).toEqual({
      status: 200,
      json: { ok: true, path: notePath, name: 'structured' }
    })
    expect(await fs.readFile(notePath, 'utf8')).toBe('{\n  "title": "Morning",\n  "done": false\n}')

    const written = await requestAppTools('PUT', '/notes', {
      path: 'structured',
      content: false
    })

    expect(written).toEqual({
      status: 200,
      json: { ok: true, path: notePath }
    })
    expect(await fs.readFile(notePath, 'utf8')).toBe('false')
  })

  it('rejects note symlinks that resolve outside the notes root', async () => {
    const outsideDir = `${tmpDir}-outside`
    const outsideFile = path.join(outsideDir, 'secret.md')
    const escapeFile = path.join(tmpDir, 'escape.md')
    const escapeDir = path.join(tmpDir, 'linked-outside')
    await fs.mkdir(outsideDir, { recursive: true })

    try {
      await fs.writeFile(outsideFile, 'outside\n', 'utf8')
      await fs.symlink(outsideFile, escapeFile)
      await fs.symlink(outsideDir, escapeDir, 'dir')

      const read = await requestAppTools('GET', '/notes/read?path=escape')
      const write = await requestAppTools('PUT', '/notes', {
        path: 'escape',
        content: 'overwrite'
      })
      const create = await requestAppTools('POST', '/notes', {
        parent: 'linked-outside',
        name: 'created',
        content: 'created'
      })
      const remove = await requestAppTools('DELETE', '/notes?path=escape')

      expect(read.status).toBe(500)
      expect(read.json.error).toContain('Note path resolves outside the notes root directory')
      expect(write.status).toBe(500)
      expect(write.json.error).toContain('Note path resolves outside the notes root directory')
      expect(create.status).toBe(500)
      expect(create.json.error).toContain('Note parent resolves outside the notes root directory')
      expect(remove.status).toBe(500)
      expect(remove.json.error).toContain('Note path resolves outside the notes root directory')
      expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside\n')
      await expect(fs.stat(path.join(outsideDir, 'created.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('app tools settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isSupportedSettingPath.mockReturnValue(true)
    mocks.persistSettingValue.mockResolvedValue(undefined)
  })

  it('rejects missing setting values without writing undefined', async () => {
    const result = await requestAppTools('PATCH', '/settings/value', { path: 'theme' })

    expect(result).toEqual({
      status: 400,
      json: { error: 'Setting value is required' }
    })
    expect(mocks.persistSettingValue).not.toHaveBeenCalled()
  })

  it('keeps falsy setting values valid', async () => {
    const result = await requestAppTools('PATCH', '/settings/value', { path: 'showTopics', value: false })

    expect(result).toEqual({
      status: 200,
      json: { ok: true, path: 'showTopics', value: false }
    })
    expect(mocks.persistSettingValue).toHaveBeenCalledWith('showTopics', false)
  })
})
