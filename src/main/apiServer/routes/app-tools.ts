import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { appCapabilityService } from '@main/services/appCapabilities'
import { listPaintingHistory, PAINTING_NAMESPACES } from '@main/services/appCapabilities/providers/paintings'
import { isAllowedAppRoute, normalizeAppRoute, pickPath, sanitizeForAgent } from '@main/services/appCapabilities/utils'
import { reduxService } from '@main/services/ReduxService'
import { windowService } from '@main/services/WindowService'
import { getName, getNotesDir, isPathInside, scanDir } from '@main/utils/file'
import express from 'express'

const logger = loggerService.withContext('ApiServer:AppTools')
const appToolsRouter = express.Router()

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

const SETTINGS_SETTERS: Record<string, string> = {
  language: 'settings/setLanguage',
  targetLanguage: 'settings/setTargetLanguage',
  theme: 'settings/setTheme',
  fontSize: 'settings/setFontSize',
  navbarPosition: 'settings/setNavbarPosition',
  assistantIconType: 'settings/setAssistantIconType',
  messageStyle: 'settings/setMessageStyle',
  defaultPaintingProvider: 'settings/setDefaultPaintingProvider',
  enableDeveloperMode: 'settings/setEnableDeveloperMode'
}

async function navigate(route: string) {
  const nextRoute = normalizeAppRoute(route)
  if (!isAllowedAppRoute(nextRoute)) {
    throw new Error(`Navigation route is not allowed: ${nextRoute}`)
  }

  const win = windowService.getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('Main window is not available')

  await win.webContents.executeJavaScript(`window.navigate(${JSON.stringify(nextRoute)})`)
  if (isMac) windowService.showMainWindow()
}

async function getNotesRoot() {
  const noteState = await reduxService.select<any>('state.note').catch(() => null)
  return path.resolve(noteState?.notesPath || getNotesDir())
}

function resolveNotePath(root: string, input?: string, defaultExt = false) {
  const raw = (input || '').trim()
  const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(root, raw))
  const withExt = defaultExt && path.extname(candidate) === '' ? `${candidate}.md` : candidate
  if (withExt !== root && !isPathInside(withExt, root)) throw new Error('Path is outside the notes directory')
  return withExt
}

function flattenNotes(nodes: any[], result: any[] = []) {
  for (const node of nodes) {
    if (node.type === 'file') result.push(node)
    if (node.children) flattenNotes(node.children, result)
  }
  return result
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
    res.json({ settings: sanitizeForAgent(await reduxService.select('state.settings')) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/settings/value', async (req, res, next) => {
  try {
    const settings = await reduxService.select('state.settings')
    res.json({ path: req.query.path || '', value: sanitizeForAgent(pickPath(settings, String(req.query.path || ''))) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.patch('/settings/value', async (req, res, next) => {
  try {
    const { path: keyPath, value } = req.body ?? {}
    const action = SETTINGS_SETTERS[keyPath]
    if (!action) {
      res.status(400).json({ error: `Unsupported setting path: ${keyPath}` })
      return
    }
    await reduxService.dispatch({ type: action, payload: value })
    res.json({ ok: true, path: keyPath, value: sanitizeForAgent(value) })
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
    res.json({ root, notes: await scanDir(root) })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/notes/read', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const filePath = resolveNotePath(root, String(req.query.path || ''), true)
    res.json({ path: filePath, content: await fs.readFile(filePath, 'utf8') })
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
    const files = flattenNotes(await scanDir(root)).slice(0, Number(req.query.limit || 100))
    const matches: any[] = []
    for (const file of files) {
      const content = await fs.readFile(file.externalPath, 'utf8').catch(() => '')
      const index = content.toLowerCase().indexOf(query)
      if (index >= 0 || file.name.toLowerCase().includes(query)) {
        matches.push({ ...file, snippet: content.slice(Math.max(index - 80, 0), index + 180) })
      }
    }
    res.json({ query, matches })
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
    await fs.writeFile(filePath, req.body?.content || '', 'utf8')
    res.json({ ok: true, path: filePath, name: safeName })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.put('/notes', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const filePath = resolveNotePath(root, req.body?.path, true)
    await fs.writeFile(filePath, req.body?.content || '', 'utf8')
    res.json({ ok: true, path: filePath })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.delete('/notes', async (req, res, next) => {
  try {
    const root = await getNotesRoot()
    const target = resolveNotePath(root, String(req.query.path || req.body?.path || ''))
    await fs.rm(target, { force: true, recursive: true })
    res.json({ ok: true, path: target })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/paintings/providers', async (_req, res, next) => {
  try {
    const settings = await reduxService.select<any>('state.settings')
    res.json({ defaultProvider: settings?.defaultPaintingProvider, namespaces: PAINTING_NAMESPACES })
  } catch (error) {
    next(error)
  }
})

appToolsRouter.get('/paintings', async (req, res, next) => {
  try {
    const paintings = await reduxService.select<any>('state.paintings')
    res.json(listPaintingHistory(paintings, req.query))
  } catch (error) {
    next(error)
  }
})

appToolsRouter.patch('/paintings/default-provider', async (req, res, next) => {
  try {
    await reduxService.dispatch({ type: 'settings/setDefaultPaintingProvider', payload: req.body?.provider })
    res.json({ ok: true, defaultProvider: req.body?.provider })
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
