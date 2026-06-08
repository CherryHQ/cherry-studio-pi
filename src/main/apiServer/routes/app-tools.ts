import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isMac } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { appCapabilityService } from '@main/services/appCapabilities'
import { listPaintingHistory, PAINTING_NAMESPACES } from '@main/services/appCapabilities/providers/paintings'
import {
  isSupportedSettingPath,
  persistSettingValue,
  readSettingsForAgent
} from '@main/services/appCapabilities/providers/settings'
import { readRendererStoreValue } from '@main/services/appCapabilities/rendererBridge'
import { isAllowedAppRoute, normalizeAppRoute, pickPath, sanitizeForAgent } from '@main/services/appCapabilities/utils'
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

const SETTINGS_SECTIONS = [
  ['provider', 'Provider', '/settings/provider'],
  ['model', 'Models', '/settings/model'],
  ['general', 'General', '/settings/general'],
  ['display', 'Display', '/settings/display'],
  ['data', 'Data', '/settings/data'],
  ['environment', 'Environment dependencies', '/settings/environment'],
  ['mcp', 'MCP', '/settings/mcp'],
  ['skills', 'Skills', '/settings/skills'],
  ['websearch', 'Web Search', '/settings/websearch'],
  ['memory', 'Memory', '/settings/memory'],
  ['api-server', 'API Server', '/settings/api-server'],
  ['channels', 'Channels', '/settings/channels'],
  ['scheduled-tasks', 'Scheduled tasks', '/settings/scheduled-tasks'],
  ['docprocess', 'Document processing', '/settings/docprocess'],
  ['quickphrase', 'Quick phrases', '/settings/quickphrase'],
  ['shortcut', 'Shortcuts', '/settings/shortcut'],
  ['quickAssistant', 'Quick Assistant', '/settings/quickAssistant'],
  ['selectionAssistant', 'Selection Assistant', '/settings/selectionAssistant'],
  ['about', 'About', '/settings/about']
].map(([id, label, route]) => ({ id, label, route }))

async function navigate(route: string) {
  const nextRoute = normalizeAppRoute(route)
  if (!isAllowedAppRoute(nextRoute)) {
    throw new Error(`Navigation route is not allowed: ${nextRoute}`)
  }

  const win = application.get('WindowManager').getWindowsByType(WindowType.Main)[0]
  if (!win || win.isDestroyed()) throw new Error('Main window is not available')

  await win.webContents.executeJavaScript(`window.navigate(${JSON.stringify(nextRoute)})`)
  if (isMac) application.get('MainWindowService').showMainWindow()
}

async function getNotesRoot() {
  const preferredPath = await Promise.resolve()
    .then(() => application.get('PreferenceService').get('feature.notes.path'))
    .catch(() => '')
  if (typeof preferredPath === 'string' && preferredPath.trim()) return path.resolve(preferredPath.trim())

  const noteState = await readRendererStoreValue<any>('state.note').catch(() => null)
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

async function scanNotesTreeBounded(root: string) {
  let scannedEntries = 0
  let scanTruncated = false

  const scanDirectory = async (dirPath: string, depth: number): Promise<any[]> => {
    if (depth > MAX_NOTES_LIST_DEPTH || scanTruncated) {
      scanTruncated = true
      return []
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])
    const nodes: any[] = []

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
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

async function collectNoteFilesForSearch(root: string) {
  const files: any[] = []
  const stack = [{ dirPath: root, depth: 0 }]
  let scannedEntries = 0
  let scanTruncated = false

  while (stack.length > 0 && files.length < MAX_NOTES_SEARCH_FILES && !scanTruncated) {
    const current = stack.pop()!
    const entries = await fs.readdir(current.dirPath, { withFileTypes: true }).catch(() => [])
    const childDirectories: Array<{ dirPath: string; depth: number }> = []

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
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

async function readTextFilePreview(filePath: string, maxBytes: number) {
  const stat = await fs.stat(filePath)
  if (stat.size <= maxBytes) {
    return {
      content: await fs.readFile(filePath, 'utf8'),
      byteSize: stat.size,
      truncated: false,
      maxBytes
    }
  }

  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
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
  try {
    const result = await appCapabilityService.call(req.params.id, req.body?.input ?? req.body ?? {}, {
      source: 'api',
      dryRun: req.body?.dryRun === true
    })
    res.status(result.ok ? 200 : 400).json(result)
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/settings', async (_req, res, next) => {
  try {
    res.json({ settings: sanitizeForAgent(await readSettingsForAgent()) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/settings/value', async (req, res, next) => {
  try {
    const settings = await readSettingsForAgent()
    res.json({ path: req.query.path || '', value: sanitizeForAgent(pickPath(settings, String(req.query.path || ''))) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.patch('/settings/value', async (req, res, next) => {
  try {
    const { path: keyPath, value } = req.body ?? {}
    const normalizedPath = String(keyPath || '').trim()
    if (!normalizedPath || !isSupportedSettingPath(normalizedPath)) {
      res.status(400).json({ error: `Unsupported setting path: ${keyPath}` })
      return
    }
    await persistSettingValue(normalizedPath, value)
    res.json({ ok: true, path: normalizedPath, value: sanitizeForAgent(value) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.post('/settings/open', async (req, res, next) => {
  try {
    const section = SETTINGS_SECTIONS.find((item) => item.id === req.body?.section || item.route === req.body?.route)
    await navigate(section?.route || req.body?.route || '/settings/provider')
    res.json({ ok: true, route: section?.route || req.body?.route })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.post('/navigate', async (req, res, next) => {
  try {
    await navigate(req.body?.route || '/')
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/notes', async (_req, res, next) => {
  try {
    const root = await getNotesRoot()
    res.json({ root, ...(await scanNotesTreeBounded(root)) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/notes/read', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const filePath = resolveNotePath(root, String(req.query.path || ''), true)
    const maxBytes = normalizePositiveInteger(req.query.maxBytes, DEFAULT_NOTE_READ_MAX_BYTES, MAX_NOTE_READ_MAX_BYTES)
    res.json({ path: filePath, ...(await readTextFilePreview(filePath, maxBytes)) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/notes/search', async (req, res, next) => {
  try {
    const query = String(req.query.q || '')
      .trim()
      .toLowerCase()
    if (!query) {
      res.status(400).json({ error: 'Missing search query' })
      return
    }
    const root = await getNotesRoot()
    const limit = normalizePositiveInteger(req.query.limit, DEFAULT_NOTES_SEARCH_LIMIT, MAX_NOTES_SEARCH_LIMIT)
    const { files, scannedEntries, scanTruncated } = await collectNoteFilesForSearch(root)
    const matches: any[] = []
    let skippedLargeFiles = 0
    let searched = 0
    for (const file of files) {
      if (matches.length >= limit) break
      searched += 1
      const nameMatches = file.name.toLowerCase().includes(query)
      const stat = await fs.stat(file.externalPath).catch(() => null)
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
  }
})

appToolsRouter.post('/notes', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const parent = resolveNotePath(root, req.body?.parent || '')
    await fs.mkdir(parent, { recursive: true })
    const safeName = getName(parent, req.body?.name || 'Untitled', true)
    const filePath = path.join(parent, `${safeName}.md`)
    await fs.writeFile(filePath, normalizeNoteContent(req.body?.content), 'utf8')
    notifyMainProcessDataSyncLocalChange('file', { source: 'api.app-tools.notes.create', path: filePath })
    res.json({ ok: true, path: filePath, name: safeName })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.put('/notes', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const filePath = resolveNotePath(root, req.body?.path, true)
    await fs.writeFile(filePath, normalizeNoteContent(req.body?.content), 'utf8')
    notifyMainProcessDataSyncLocalChange('file', { source: 'api.app-tools.notes.write', path: filePath })
    res.json({ ok: true, path: filePath })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.delete('/notes', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const target = await resolveNoteDeletePath(root, String(req.query.path || req.body?.path || ''))
    if (isNotesRoot(root, target)) {
      res.status(400).json({ error: 'Cannot delete the notes root directory' })
      return
    }
    await fs.rm(target, { force: true, recursive: true })
    notifyMainProcessDataSyncLocalChange('file', { source: 'api.app-tools.notes.delete', path: target })
    res.json({ ok: true, path: target })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/paintings/providers', async (_req, res, next) => {
  try {
    const settings = await readSettingsForAgent()
    res.json({ defaultProvider: settings?.defaultPaintingProvider, namespaces: PAINTING_NAMESPACES })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/paintings', async (req, res, next) => {
  try {
    const paintings = await readRendererStoreValue<any>('state.paintings').catch(() => ({}))
    res.json(listPaintingHistory(paintings, req.query))
  } catch (error) {
    next(error)
  }
})

appToolsRouter.patch('/paintings/default-provider', async (req, res, next) => {
  try {
    const provider = String(req.body?.provider ?? '').trim()
    if (!provider) {
      res.status(400).json({ error: 'Painting provider is required' })
      return
    }
    await persistSettingValue('defaultPaintingProvider', provider)
    res.json({ ok: true, defaultProvider: provider })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next
  logger.warn('App tools route failed', { error: error instanceof Error ? error.message : String(error) })
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
})

export { appToolsRouter as appToolsRoutes }
