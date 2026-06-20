import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { appCapabilityService } from '@main/services/appCapabilities'
import { listPaintingHistory, PAINTING_NAMESPACES } from '@main/services/appCapabilities/providers/paintings'
import {
  isSupportedSettingPath,
  persistSettingValue,
  readSettingsForAgent
} from '@main/services/appCapabilities/providers/settings'
import { readRendererStoreValue } from '@main/services/appCapabilities/rendererBridge'
import { navigateApp, pickPath, sanitizeForAgent } from '@main/services/appCapabilities/utils'
import { notifyMainProcessDataSyncLocalChange } from '@main/services/appData/DataSyncLocalChangeNotifier'
import { getName, getNotesDir, isPathInside } from '@main/utils/file'
import express from 'express'

const logger = loggerService.withContext('ApiServer:AppTools')
const appToolsRouter = express.Router()
const DEFAULT_NOTES_SEARCH_LIMIT = 50
const MAX_NOTES_SEARCH_LIMIT = 200
const MAX_NOTES_SEARCH_FILES = 5_000
const MAX_NOTE_SEARCH_FILE_BYTES = 512 * 1024
const MAX_NOTES_LIST_SCAN_ENTRIES = 5_000
const MAX_NOTES_LIST_DEPTH = 10
const DEFAULT_NOTE_READ_MAX_BYTES = 512 * 1024
const MAX_NOTE_READ_MAX_BYTES = 2 * 1024 * 1024
const PAINTING_PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/

const SETTINGS_SECTIONS = [
  ['provider', 'Provider', '/settings/provider'],
  ['model', 'Models', '/settings/model'],
  ['api-gateway', 'API Gateway', '/settings/api-gateway'],
  ['mcp', 'MCP', '/settings/mcp'],
  ['websearch', 'Web Search', '/settings/websearch'],
  ['file-processing', 'Document processing', '/settings/file-processing'],
  ['integrations', 'Integrations', '/settings/integrations'],
  ['plugins', 'Environment dependencies', '/settings/plugins'],
  ['general', 'General', '/settings/general'],
  ['data', 'Data', '/settings/data'],
  ['channels', 'Channels', '/settings/channels'],
  ['scheduled-tasks', 'Scheduled tasks', '/settings/scheduled-tasks'],
  ['shortcut', 'Shortcuts', '/settings/shortcut'],
  ['quick-assistant', 'Quick Assistant', '/settings/quick-assistant'],
  ['selection-assistant', 'Selection Assistant', '/settings/selection-assistant'],
  ['prompts', 'Prompts', '/settings/prompts'],
  ['about', 'About', '/settings/about']
].map(([id, label, route]) => ({ id, label, route }))

function createAppToolsAbortError(signal: AbortSignal, fallbackMessage = 'App tools request was aborted') {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string' && reason.trim()) return new Error(reason.trim())
  return new Error(fallbackMessage)
}

function throwIfAppToolsSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw createAppToolsAbortError(signal)
}

async function getNotesRoot(signal?: AbortSignal) {
  throwIfAppToolsSignalAborted(signal)
  const preferredPath = await Promise.resolve()
    .then(() => application.get('PreferenceService').get('feature.notes.path'))
    .catch(() => '')
  throwIfAppToolsSignalAborted(signal)
  if (typeof preferredPath === 'string' && preferredPath.trim()) return path.resolve(preferredPath.trim())

  const noteState = await readRendererStoreValue<any>('state.note', { signal }).catch((error) => {
    if (signal?.aborted) throw error
    return null
  })
  throwIfAppToolsSignalAborted(signal)
  return path.resolve(noteState?.notesPath || getNotesDir())
}

function resolveNotePath(root: string, input?: string, defaultExt = false) {
  const raw = (input || '').trim()
  const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(root, raw))
  const withExt = defaultExt && path.extname(candidate) === '' ? `${candidate}.md` : candidate
  if (withExt !== root && !isPathInside(withExt, root)) throw new Error('Path is outside the notes directory')
  return withExt
}

function isNotesRoot(root: string, target: string) {
  return path.resolve(root) === path.resolve(target)
}

function isPathInsideOrEqual(target: string, root: string) {
  const relativePath = path.relative(path.resolve(root), path.resolve(target))
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

async function realpathOrResolvedPath(filePath: string) {
  try {
    return await fs.realpath(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path.resolve(filePath)
    throw error
  }
}

async function resolveRealPathPreservingMissingSegments(filePath: string) {
  const missingSegments: string[] = []
  let current = path.resolve(filePath)

  while (true) {
    try {
      return path.join(await fs.realpath(current), ...missingSegments.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const parent = path.dirname(current)
    if (parent === current) return path.resolve(filePath)
    missingSegments.push(path.basename(current))
    current = parent
  }
}

async function assertResolvedInsideNotesRoot(root: string, target: string, label = 'Note path') {
  const realRoot = await realpathOrResolvedPath(root)
  const realTarget = await resolveRealPathPreservingMissingSegments(target)
  if (!isPathInsideOrEqual(realTarget, realRoot)) {
    throw new Error(`${label} resolves outside the notes root directory`)
  }
}

function normalizeNoteContent(value: unknown) {
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'undefined') return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2) ?? ''
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function normalizePaintingProviderId(value: unknown) {
  const provider = typeof value === 'string' ? value.trim() : ''
  if (!provider) return ''
  if (!PAINTING_PROVIDER_ID_PATTERN.test(provider)) {
    throw new Error('Painting provider must be a route-safe provider id')
  }
  return provider
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function resolveCapabilityCallBody(body: unknown) {
  if (!isRecord(body)) {
    return { input: {}, dryRun: false }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'input')) {
    return { input: body.input ?? {}, dryRun: body.dryRun === true }
  }

  const keys = Object.keys(body)
  const hasOnlyControlFields = keys.length > 0 && keys.every((key) => key === 'dryRun')
  return {
    input: hasOnlyControlFields ? {} : body,
    dryRun: body.dryRun === true
  }
}

function createResponseAbortSignal(res: express.Response) {
  const controller = new AbortController()
  let disposed = false

  const cleanup = () => {
    if (disposed) return
    disposed = true
    res.off('close', abort)
    res.off('finish', cleanup)
  }

  const abort = () => {
    const shouldAbort = !res.writableEnded
    cleanup()
    if (shouldAbort && !controller.signal.aborted) {
      controller.abort(new Error('HTTP client disconnected before app capability completed'))
    }
  }

  res.once('close', abort)
  res.once('finish', cleanup)

  return {
    signal: controller.signal,
    dispose: cleanup
  }
}

async function resolveNoteDeletePath(root: string, input?: string) {
  const target = resolveNotePath(root, input)
  if (path.extname(target) || (await fs.stat(target).catch(() => null))) {
    return target
  }

  const markdownTarget = `${target}.md`
  const markdownStat = await fs.stat(markdownTarget).catch(() => null)
  return markdownStat?.isFile() ? markdownTarget : target
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'string' && !value.trim() ? fallback : Number(value ?? fallback)
  const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
  return Math.max(1, Math.min(normalized, max))
}

function noteNodeId(externalPath: string) {
  return createHash('sha1').update(externalPath.replace(/\\/g, '/')).digest('hex')
}

function toNoteTreePath(root: string, entryPath: string, stripMarkdownExt = false) {
  let relativePath = path.relative(root, entryPath).replace(/\\/g, '/')
  if (stripMarkdownExt) relativePath = relativePath.replace(/\.md$/i, '')
  return `/${relativePath}`
}

async function scanNotesTreeBounded(root: string, signal?: AbortSignal) {
  let scannedEntries = 0
  let scanTruncated = false

  const scanDirectory = async (dirPath: string, depth: number): Promise<any[]> => {
    throwIfAppToolsSignalAborted(signal)
    if (depth > MAX_NOTES_LIST_DEPTH || scanTruncated) {
      scanTruncated = true
      return []
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])
    throwIfAppToolsSignalAborted(signal)
    const nodes: any[] = []

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
      throwIfAppToolsSignalAborted(signal)
      if (entry.name.startsWith('.')) continue
      scannedEntries += 1
      if (scannedEntries > MAX_NOTES_LIST_SCAN_ENTRIES) {
        scanTruncated = true
        break
      }

      const entryPath = path.join(dirPath, entry.name)
      const externalPath = entryPath.replace(/\\/g, '/')
      if (entry.isDirectory()) {
        const stats = await fs.stat(entryPath).catch(() => null)
        throwIfAppToolsSignalAborted(signal)
        nodes.push({
          id: noteNodeId(externalPath),
          name: entry.name,
          treePath: toNoteTreePath(root, entryPath),
          externalPath,
          createdAt: stats?.birthtime.toISOString() ?? null,
          updatedAt: stats?.mtime.toISOString() ?? null,
          type: 'folder',
          children: await scanDirectory(entryPath, depth + 1)
        })
        continue
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue

      const stats = await fs.stat(entryPath).catch(() => null)
      throwIfAppToolsSignalAborted(signal)
      const name = path.basename(entry.name, path.extname(entry.name))
      nodes.push({
        id: noteNodeId(externalPath),
        name,
        treePath: toNoteTreePath(root, entryPath, true),
        externalPath,
        createdAt: stats?.birthtime.toISOString() ?? null,
        updatedAt: stats?.mtime.toISOString() ?? null,
        type: 'file',
        children: []
      })
    }

    return nodes
  }

  return {
    notes: await scanDirectory(root, 0),
    scannedEntries,
    scanLimit: MAX_NOTES_LIST_SCAN_ENTRIES,
    scanTruncated
  }
}

async function collectNoteFilesForSearch(root: string, signal?: AbortSignal) {
  const files: any[] = []
  const stack = [{ dirPath: root, depth: 0 }]
  let scannedEntries = 0
  let scanTruncated = false

  while (stack.length > 0 && files.length < MAX_NOTES_SEARCH_FILES && !scanTruncated) {
    throwIfAppToolsSignalAborted(signal)
    const current = stack.pop()!
    const entries = await fs.readdir(current.dirPath, { withFileTypes: true }).catch(() => [])
    throwIfAppToolsSignalAborted(signal)
    const childDirectories: Array<{ dirPath: string; depth: number }> = []

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
      throwIfAppToolsSignalAborted(signal)
      if (entry.name.startsWith('.')) continue
      scannedEntries += 1
      if (scannedEntries > MAX_NOTES_LIST_SCAN_ENTRIES) {
        scanTruncated = true
        break
      }

      const entryPath = path.join(current.dirPath, entry.name)
      if (entry.isDirectory()) {
        if (current.depth < MAX_NOTES_LIST_DEPTH) {
          childDirectories.push({ dirPath: entryPath, depth: current.depth + 1 })
        }
        continue
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue

      const externalPath = entryPath.replace(/\\/g, '/')
      files.push({
        id: noteNodeId(externalPath),
        type: 'file',
        name: path.basename(entry.name, path.extname(entry.name)),
        treePath: toNoteTreePath(root, entryPath, true),
        externalPath
      })

      if (files.length >= MAX_NOTES_SEARCH_FILES) {
        scanTruncated = true
        break
      }
    }

    for (const child of childDirectories.reverse()) {
      stack.push(child)
    }
  }

  return {
    files,
    scannedEntries,
    scanTruncated: scanTruncated || stack.length > 0
  }
}

async function readTextFilePreview(filePath: string, maxBytes: number, signal?: AbortSignal) {
  throwIfAppToolsSignalAborted(signal)
  const stat = await fs.stat(filePath)
  throwIfAppToolsSignalAborted(signal)
  if (stat.size <= maxBytes) {
    const content = await fs.readFile(filePath, 'utf8')
    throwIfAppToolsSignalAborted(signal)
    return {
      content,
      byteSize: stat.size,
      truncated: false,
      maxBytes
    }
  }

  const handle = await fs.open(filePath, 'r')
  try {
    throwIfAppToolsSignalAborted(signal)
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    throwIfAppToolsSignalAborted(signal)
    return {
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      byteSize: stat.size,
      truncated: true,
      maxBytes
    }
  } finally {
    await handle.close()
  }
}

appToolsRouter.get('/settings/sections', (_req, res) => {
  res.json({ sections: SETTINGS_SECTIONS })
})

appToolsRouter.get('/capabilities', (req, res, next) => {
  try {
    res.json({
      capabilities: appCapabilityService.list({
        domain: req.query.domain ? String(req.query.domain) : undefined,
        risk: req.query.risk ? (String(req.query.risk) as any) : undefined,
        includeHidden: req.query.includeHidden === 'true',
        includeSchemas: req.query.includeSchemas === 'true'
      })
    })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/capabilities/search', (req, res, next) => {
  try {
    res.json({
      capabilities: appCapabilityService.search({
        query: String(req.query.q || req.query.query || ''),
        domain: req.query.domain ? String(req.query.domain) : undefined,
        risk: req.query.risk ? (String(req.query.risk) as any) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        includeHidden: req.query.includeHidden === 'true',
        includeSchemas: req.query.includeSchemas === 'true'
      })
    })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.post('/capabilities/:id/call', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const { input, dryRun } = resolveCapabilityCallBody(req.body)
    const result = await appCapabilityService.call(req.params.id, input, {
      source: 'api',
      dryRun,
      signal: responseAbort.signal
    })
    res.status(result.ok ? 200 : 400).json(result)
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/settings', async (_req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    res.json({ settings: sanitizeForAgent(await readSettingsForAgent(responseAbort.signal)) })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/settings/value', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const settings = await readSettingsForAgent(responseAbort.signal)
    res.json({ path: req.query.path || '', value: sanitizeForAgent(pickPath(settings, String(req.query.path || ''))) })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.patch('/settings/value', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const { path: keyPath, value } = req.body ?? {}
    const normalizedPath = String(keyPath || '').trim()
    if (!normalizedPath || !isSupportedSettingPath(normalizedPath)) {
      res.status(400).json({ error: `Unsupported setting path: ${keyPath}` })
      return
    }
    if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, 'value')) {
      res.status(400).json({ error: 'Setting value is required' })
      return
    }
    await persistSettingValue(normalizedPath, value, responseAbort.signal)
    res.json({ ok: true, path: normalizedPath, value: sanitizeForAgent(value) })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.post('/settings/open', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const section = SETTINGS_SECTIONS.find((item) => item.id === req.body?.section || item.route === req.body?.route)
    const route = section?.route || req.body?.route || '/settings/provider'
    await navigateApp(route, responseAbort.signal)
    res.json({ ok: true, route })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.post('/navigate', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    await navigateApp(req.body?.route || '/', responseAbort.signal)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/notes', async (_req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const root = await getNotesRoot(responseAbort.signal)
    res.json({ root, ...(await scanNotesTreeBounded(root, responseAbort.signal)) })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/notes/read', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const root = await getNotesRoot(responseAbort.signal)
    const filePath = resolveNotePath(root, String(req.query.path || ''), true)
    await assertResolvedInsideNotesRoot(root, filePath)
    throwIfAppToolsSignalAborted(responseAbort.signal)
    const maxBytes = normalizePositiveInteger(req.query.maxBytes, DEFAULT_NOTE_READ_MAX_BYTES, MAX_NOTE_READ_MAX_BYTES)
    res.json({ path: filePath, ...(await readTextFilePreview(filePath, maxBytes, responseAbort.signal)) })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/notes/search', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const query = String(req.query.q || '')
      .trim()
      .toLowerCase()
    if (!query) {
      res.status(400).json({ error: 'Missing search query' })
      return
    }
    const root = await getNotesRoot(responseAbort.signal)
    const limit = normalizePositiveInteger(req.query.limit, DEFAULT_NOTES_SEARCH_LIMIT, MAX_NOTES_SEARCH_LIMIT)
    const { files, scannedEntries, scanTruncated } = await collectNoteFilesForSearch(root, responseAbort.signal)
    const matches: any[] = []
    let skippedLargeFiles = 0
    let searched = 0
    for (const file of files) {
      throwIfAppToolsSignalAborted(responseAbort.signal)
      if (matches.length >= limit) break
      searched += 1
      const nameMatches = file.name.toLowerCase().includes(query)
      const stat = await fs.stat(file.externalPath).catch(() => null)
      throwIfAppToolsSignalAborted(responseAbort.signal)
      if (!stat?.isFile()) continue

      if (nameMatches) {
        matches.push({ ...file, byteSize: stat.size, match: 'name', snippet: '' })
        continue
      }

      if (stat.size > MAX_NOTE_SEARCH_FILE_BYTES) {
        skippedLargeFiles += 1
        continue
      }

      const content = await fs.readFile(file.externalPath, 'utf8').catch(() => '')
      throwIfAppToolsSignalAborted(responseAbort.signal)
      const index = content.toLowerCase().indexOf(query)
      if (index >= 0) {
        matches.push({
          ...file,
          byteSize: stat.size,
          match: 'content',
          snippet: content.slice(Math.max(index - 80, 0), index + 180)
        })
      }
    }
    res.json({
      query,
      matches,
      limit,
      searched,
      scannedEntries,
      scanTruncated,
      skippedLargeFiles,
      maxFileBytes: MAX_NOTE_SEARCH_FILE_BYTES
    })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.post('/notes', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const root = await getNotesRoot(responseAbort.signal)
    const parent = resolveNotePath(root, req.body?.parent || '')
    await assertResolvedInsideNotesRoot(root, parent, 'Note parent')
    throwIfAppToolsSignalAborted(responseAbort.signal)
    await fs.mkdir(parent, { recursive: true })
    const safeName = getName(parent, req.body?.name || 'Untitled', true)
    const filePath = path.join(parent, `${safeName}.md`)
    await assertResolvedInsideNotesRoot(root, filePath)
    throwIfAppToolsSignalAborted(responseAbort.signal)
    await fs.writeFile(filePath, normalizeNoteContent(req.body?.content), 'utf8')
    notifyMainProcessDataSyncLocalChange('file', { source: 'api.app-tools.notes.create', path: filePath })
    res.json({ ok: true, path: filePath, name: safeName })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.put('/notes', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const root = await getNotesRoot(responseAbort.signal)
    const filePath = resolveNotePath(root, req.body?.path, true)
    await assertResolvedInsideNotesRoot(root, filePath)
    throwIfAppToolsSignalAborted(responseAbort.signal)
    await fs.writeFile(filePath, normalizeNoteContent(req.body?.content), 'utf8')
    notifyMainProcessDataSyncLocalChange('file', { source: 'api.app-tools.notes.write', path: filePath })
    res.json({ ok: true, path: filePath })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.delete('/notes', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const root = await getNotesRoot(responseAbort.signal)
    const target = await resolveNoteDeletePath(root, String(req.query.path || req.body?.path || ''))
    if (isNotesRoot(root, target)) {
      res.status(400).json({ error: 'Cannot delete the notes root directory' })
      return
    }
    await assertResolvedInsideNotesRoot(root, target)
    throwIfAppToolsSignalAborted(responseAbort.signal)
    await fs.rm(target, { force: true, recursive: true })
    notifyMainProcessDataSyncLocalChange('file', { source: 'api.app-tools.notes.delete', path: target })
    res.json({ ok: true, path: target })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/paintings/providers', async (_req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const settings = await readSettingsForAgent(responseAbort.signal)
    res.json({ defaultProvider: settings?.defaultPaintingProvider, namespaces: PAINTING_NAMESPACES })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.get('/paintings', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const paintings = await readRendererStoreValue<any>('state.paintings', { signal: responseAbort.signal }).catch(
      (error) => {
        if (responseAbort.signal.aborted) throw error
        return {}
      }
    )
    throwIfAppToolsSignalAborted(responseAbort.signal)
    res.json(listPaintingHistory(paintings, req.query))
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.patch('/paintings/default-provider', async (req, res, next) => {
  const responseAbort = createResponseAbortSignal(res)
  try {
    const provider = normalizePaintingProviderId(req.body?.provider)
    if (!provider) {
      res.status(400).json({ error: 'Painting provider is required' })
      return
    }
    await persistSettingValue('defaultPaintingProvider', provider, responseAbort.signal)
    res.json({ ok: true, defaultProvider: provider })
  } catch (error) {
    next(error)
  } finally {
    responseAbort.dispose()
  }
})

appToolsRouter.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next
  logger.warn('App tools route failed', { error: error instanceof Error ? error.message : String(error) })
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
})

export { appToolsRouter as appToolsRoutes }
