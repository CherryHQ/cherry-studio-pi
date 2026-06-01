import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storageV2Database } from '../../storageV2/StorageV2Database'
import { AppDataDatabase, getAppDataDatabase } from '../AppDataDatabase'
import { AppDataSyncService } from '../AppDataSyncService'

vi.mock('@main/services/BackupManager', () => ({
  default: vi.fn()
}))

vi.unmock('node:fs')
vi.unmock('node:fs/promises')
vi.unmock('node:http')
vi.unmock('node:path')
vi.unmock('node:stream/promises')

type WebDavTestServer = {
  url: string
  root: string
  close: () => Promise<void>
}

type TestInstance = {
  userData: string
  dataRoot: string
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeRequestPath(requestUrl = '/') {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const decoded = decodeURIComponent(url.pathname)
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'))
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function resolveWebDavPath(root: string, requestUrl = '/') {
  const normalized = normalizeRequestPath(requestUrl)
  if (normalized === '..' || normalized.startsWith('/../')) {
    throw new Error('Invalid WebDAV path')
  }
  return path.join(root, normalized.slice(1))
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

function responseHref(filePath: string) {
  return `/${filePath.split(path.sep).filter(Boolean).map(encodeURIComponent).join('/')}`
}

async function propfind(root: string, req: IncomingMessage, res: ServerResponse) {
  const targetPath = resolveWebDavPath(root, req.url)
  if (!(await pathExists(targetPath))) {
    res.writeHead(404)
    res.end()
    return
  }

  const stat = await fsp.stat(targetPath)
  const requestPath = normalizeRequestPath(req.url)
  const depth = req.headers.depth === '1' ? 1 : 0
  const entries: Array<{ absolutePath: string; href: string; stat: fs.Stats }> = [
    { absolutePath: targetPath, href: requestPath, stat }
  ]

  if (stat.isDirectory() && depth === 1) {
    for (const name of await fsp.readdir(targetPath)) {
      const childPath = path.join(targetPath, name)
      entries.push({
        absolutePath: childPath,
        href: path.posix.join(requestPath, responseHref(name)),
        stat: await fsp.stat(childPath)
      })
    }
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${entries
  .map(
    (entry) => `<d:response>
  <d:href>${xmlEscape(entry.href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:resourcetype>${entry.stat.isDirectory() ? '<d:collection/>' : ''}</d:resourcetype>
      <d:getcontentlength>${entry.stat.isFile() ? entry.stat.size : 0}</d:getcontentlength>
      <d:getlastmodified>${entry.stat.mtime.toUTCString()}</d:getlastmodified>
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`
  )
  .join('\n')}
</d:multistatus>`

  res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' })
  res.end(body)
}

async function handleWebDavRequest(root: string, req: IncomingMessage, res: ServerResponse) {
  try {
    const targetPath = resolveWebDavPath(root, req.url)

    if (req.method === 'OPTIONS') {
      res.writeHead(200, { allow: 'OPTIONS, GET, HEAD, PROPFIND, MKCOL, PUT, DELETE' })
      res.end()
      return
    }

    if (req.method === 'PROPFIND') {
      await propfind(root, req, res)
      return
    }

    if (req.method === 'MKCOL') {
      if (await pathExists(targetPath)) {
        res.writeHead(405)
        res.end()
        return
      }
      await fsp.mkdir(targetPath, { recursive: true })
      res.writeHead(201)
      res.end()
      return
    }

    if (req.method === 'PUT') {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true })
      await pipeline(req, fs.createWriteStream(targetPath))
      res.writeHead(201)
      res.end()
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!(await pathExists(targetPath))) {
        res.writeHead(404)
        res.end()
        return
      }
      const stat = await fsp.stat(targetPath)
      res.writeHead(200, { 'content-length': stat.isFile() ? stat.size : 0 })
      if (req.method === 'HEAD' || !stat.isFile()) {
        res.end()
        return
      }
      fs.createReadStream(targetPath).pipe(res)
      return
    }

    if (req.method === 'DELETE') {
      await fsp.rm(targetPath, { recursive: true, force: true })
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(405)
    res.end()
  } catch (error) {
    res.writeHead(500)
    res.end(error instanceof Error ? error.message : String(error))
  }
}

async function startWebDavServer(root: string): Promise<WebDavTestServer> {
  await fsp.mkdir(root, { recursive: true })
  const server = createServer((req, res) => {
    void handleWebDavRequest(root, req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start local WebDAV server')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    root,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()))
      })
  }
}

function makeInstance(root: string, name: string): TestInstance {
  return {
    userData: path.join(root, name),
    dataRoot: path.join(root, name, 'Data')
  }
}

async function switchInstance(instance: TestInstance, homePath: string) {
  await AppDataDatabase.close()
  storageV2Database.close()
  process.env.CHERRY_STUDIO_STORAGE_V2_ROOT = instance.dataRoot
  vi.mocked(app.getPath).mockImplementation((key: string) => {
    switch (key) {
      case 'userData':
        return instance.userData
      case 'home':
        return homePath
      case 'appData':
        return path.join(homePath, 'Library', 'Application Support')
      case 'temp':
        return path.join(homePath, 'tmp')
      default:
        return path.join(homePath, key)
    }
  })
}

async function seedInstanceData(input: {
  appRecordValue: unknown
  appRecordUpdatedAt: number
  storageSettingValue: unknown
  storageSettingUpdatedAt: string
}) {
  const appDb = await getAppDataDatabase()
  await appDb.setRecord('settings', 'sync.integration.theme', input.appRecordValue, input.appRecordUpdatedAt)

  const storageClient = await storageV2Database.getClient()
  await storageClient.execute({
    sql: `
      INSERT INTO settings (key, value_json, scope, updated_at, version, deleted_at)
      VALUES (?, ?, 'app', ?, 1, NULL)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at,
        version = settings.version + 1,
        deleted_at = NULL
    `,
    args: [
      'settings.sync.integration.storage',
      JSON.stringify(input.storageSettingValue),
      input.storageSettingUpdatedAt
    ]
  })
}

async function readInstanceState() {
  const appDb = await getAppDataDatabase()
  const appRecord = await appDb.getRecord('settings', 'sync.integration.theme')
  const storageClient = await storageV2Database.getClient()
  const storageResult = await storageClient.execute({
    sql: 'SELECT value_json FROM settings WHERE key = ?',
    args: ['settings.sync.integration.storage']
  })

  return {
    appRecord,
    storageSetting: JSON.parse(String(storageResult.rows[0]?.value_json ?? 'null'))
  }
}

async function readAllRemoteText(root: string) {
  const values: string[] = []

  async function walk(currentPath: string) {
    for (const entry of await fsp.readdir(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else {
        values.push(await fsp.readFile(entryPath, 'utf8').catch(() => ''))
      }
    }
  }

  await walk(root)
  return values.join('\n')
}

describe('AppDataSyncService local WebDAV integration', () => {
  let tempRoot: string
  let server: WebDavTestServer | null = null

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(process.cwd(), '.context', 'webdav-sync-integration-'))
    server = await startWebDavServer(path.join(tempRoot, 'webdav-root'))
  })

  afterEach(async () => {
    await AppDataDatabase.close()
    storageV2Database.close()
    delete process.env.CHERRY_STUDIO_STORAGE_V2_ROOT
    await server?.close()
    await fsp.rm(tempRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('syncs two isolated instances through a real local WebDAV server', async () => {
    const homePath = path.join(tempRoot, 'home')
    const instanceA = makeInstance(tempRoot, 'device-a')
    const instanceB = makeInstance(tempRoot, 'device-b')
    const config = {
      webdavHost: server!.url,
      webdavUser: 'user',
      webdavPass: 'pass',
      webdavPath: '/cherry-studio-pi-integration'
    }
    const backupManager = {
      backup: vi.fn(async (_event: unknown, fileName: string) => {
        const backupPath = path.join(tempRoot, fileName)
        await fsp.writeFile(backupPath, `backup:${fileName}`)
        return backupPath
      }),
      restore: vi.fn()
    }

    await switchInstance(instanceA, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'device-a-user-value' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:00:00.000Z'),
      storageSettingValue: { owner: 'device-a-storage-value' },
      storageSettingUpdatedAt: '2026-05-29T12:00:00.000Z'
    })
    const serviceA = new AppDataSyncService(backupManager as never)
    const firstSummary = await serviceA.syncNow(config)

    await switchInstance(instanceB, homePath)
    await seedInstanceData({
      appRecordValue: { mode: 'device-b-default' },
      appRecordUpdatedAt: Date.parse('2026-05-29T12:20:00.000Z'),
      storageSettingValue: { owner: 'device-b-storage-default' },
      storageSettingUpdatedAt: '2026-05-29T12:20:00.000Z'
    })
    const serviceB = new AppDataSyncService(backupManager as never)
    const secondSummary = await serviceB.syncNow(config)
    const deviceBState = await readInstanceState()
    const remoteText = await readAllRemoteText(server!.root)

    expect(firstSummary.uploaded + (firstSummary.storageUploaded ?? 0)).toBeGreaterThan(0)
    expect(secondSummary.downloaded + (secondSummary.storageDownloaded ?? 0)).toBeGreaterThan(0)
    expect(secondSummary.conflicts + (secondSummary.storageConflicts ?? 0)).toBe(0)
    expect(deviceBState).toEqual({
      appRecord: { mode: 'device-a-user-value' },
      storageSetting: { owner: 'device-a-storage-value' }
    })
    expect(remoteText).toContain('device-a-user-value')
    expect(remoteText).toContain('device-a-storage-value')
    expect(remoteText).not.toContain('device-b-default')
    expect(remoteText).not.toContain('device-b-storage-default')
  })
})
