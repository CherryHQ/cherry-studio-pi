import fs from 'node:fs/promises'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesRoot: '',
  notifyDataSyncLocalChange: vi.fn(),
  appCapabilityService: {
    list: vi.fn(() => []),
    search: vi.fn(() => []),
    call: vi.fn()
  },
  mainWindow: {
    isDestroyed: vi.fn(() => false),
    webContents: {
      executeJavaScript: vi.fn()
    }
  },
  windowManager: {
    getWindowsByType: vi.fn()
  },
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
      if (name === 'WindowManager') return mocks.windowManager
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
  appCapabilityService: mocks.appCapabilityService
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
  const { baseUrl, close } = await startAppToolsServer()
  try {
    const response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = await response.json()
    return { status: response.status, json }
  } finally {
    await close()
  }
}

async function startAppToolsServer() {
  const app = express()
  app.use(express.json())
  app.use(appToolsRoutes)

  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
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
    mocks.appCapabilityService.list.mockReset()
    mocks.appCapabilityService.list.mockReturnValue([])
    mocks.appCapabilityService.search.mockReset()
    mocks.appCapabilityService.search.mockReturnValue([])
    mocks.appCapabilityService.call.mockReset()
    mocks.appCapabilityService.call.mockResolvedValue({ ok: true, summary: 'called' })
    mocks.windowManager.getWindowsByType.mockReset()
    mocks.windowManager.getWindowsByType.mockReturnValue([])
    mocks.mainWindow.isDestroyed.mockReset()
    mocks.mainWindow.isDestroyed.mockReturnValue(false)
    mocks.mainWindow.webContents.executeJavaScript.mockReset()
    mocks.mainWindow.webContents.executeJavaScript.mockResolvedValue(undefined)
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

  it('stops notes search after the API client disconnects', async () => {
    await fs.writeFile(path.join(tmpDir, 'long-search.md'), 'needle\n', 'utf8')

    let markReaddirStarted!: () => void
    let releaseReaddir!: () => void
    const readdirStarted = new Promise<void>((resolve) => {
      markReaddirStarted = resolve
    })
    const unblockReaddir = new Promise<void>((resolve) => {
      releaseReaddir = resolve
    })
    const originalReaddir = fs.readdir.bind(fs)
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementationOnce(async (...args: any[]) => {
      markReaddirStarted()
      await unblockReaddir
      return originalReaddir(...(args as [any, any])) as any
    })
    const statSpy = vi.spyOn(fs, 'stat')
    const { baseUrl, close } = await startAppToolsServer()
    const controller = new AbortController()

    try {
      const request = fetch(`${baseUrl}/notes/search?q=needle`, { signal: controller.signal }).catch((error) => error)
      await readdirStarted
      controller.abort(new Error('test client disconnected'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      releaseReaddir()

      await expect(request).resolves.toBeInstanceOf(Error)
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(readdirSpy).toHaveBeenCalled()
      expect(statSpy).not.toHaveBeenCalled()
    } finally {
      await close()
      readdirSpy.mockRestore()
      statSpy.mockRestore()
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
    expect(mocks.persistSettingValue).toHaveBeenCalledWith('showTopics', false, expect.any(AbortSignal))
  })

  it('returns the default settings route when opening settings without a body route', async () => {
    mocks.windowManager.getWindowsByType.mockReturnValue([mocks.mainWindow])

    const result = await requestAppTools('POST', '/settings/open', {})

    expect(result).toEqual({
      status: 200,
      json: { ok: true, route: '/settings/provider' }
    })
    expect(mocks.mainWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      'window.navigate({ to: "/settings/provider" })'
    )
  })
})

describe('app tools capability call routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appCapabilityService.call.mockResolvedValue({ ok: true, summary: 'called' })
  })

  it('keeps wrapped dry-run flags out of capability input payloads', async () => {
    const result = await requestAppTools('POST', '/capabilities/dataSync.sync.now/call', { dryRun: true })

    expect(result).toEqual({
      status: 200,
      json: { ok: true, summary: 'called' }
    })
    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'dataSync.sync.now',
      {},
      {
        source: 'api',
        dryRun: true,
        signal: expect.any(AbortSignal)
      }
    )
  })

  it('preserves legacy raw body capability inputs for API clients', async () => {
    await requestAppTools('POST', '/capabilities/settings.value.get/call', { path: 'theme' })

    expect(mocks.appCapabilityService.call).toHaveBeenCalledWith(
      'settings.value.get',
      { path: 'theme' },
      {
        source: 'api',
        dryRun: false,
        signal: expect.any(AbortSignal)
      }
    )
  })
})

describe('app tools painting routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.persistSettingValue.mockResolvedValue(undefined)
  })

  it('rejects route-unsafe default painting provider ids', async () => {
    const result = await requestAppTools('PATCH', '/paintings/default-provider', {
      provider: '../settings/data'
    })

    expect(result.status).toBe(500)
    expect(result.json.error).toContain('Painting provider must be a route-safe provider id')
    expect(mocks.persistSettingValue).not.toHaveBeenCalled()
  })

  it('persists valid default painting provider ids', async () => {
    const result = await requestAppTools('PATCH', '/paintings/default-provider', {
      provider: ' openai_image_generate '
    })

    expect(result).toEqual({
      status: 200,
      json: { ok: true, defaultProvider: 'openai_image_generate' }
    })
    expect(mocks.persistSettingValue).toHaveBeenCalledWith(
      'defaultPaintingProvider',
      'openai_image_generate',
      expect.any(AbortSignal)
    )
  })
})
