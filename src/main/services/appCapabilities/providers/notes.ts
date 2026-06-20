import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { notifyMainProcessDataSyncLocalChange } from '@main/services/appData/DataSyncLocalChangeNotifier'
import { getName, getNotesDir } from '@main/utils/file'

import { readRendererStoreValue } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { normalizeBoundedIntegerInput, okResult, resolveInsideRoot } from '../utils'

const DEFAULT_NOTE_SEARCH_LIMIT = 100
const MAX_NOTE_SEARCH_LIMIT = 200
const MAX_NOTE_SEARCH_FILES = 5_000
const MAX_NOTE_SEARCH_FILE_BYTES = 512 * 1024
const DEFAULT_NOTE_READ_MAX_BYTES = 512 * 1024
const MAX_NOTE_READ_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_NOTE_LIST_LIMIT = 100
const MAX_NOTE_LIST_LIMIT = 500
const MAX_NOTE_LIST_SCAN_ENTRIES = 5_000
const MAX_NOTE_LIST_DEPTH = 10
const RENDERER_STORE_FALLBACK_TIMEOUT_MS = 500
const NOTES_INPUT_OBJECT_ERROR = '笔记能力的输入必须是对象。'
const NOTES_ABORT_ERROR = '笔记能力调用已取消。'
const NOTES_ROOT_DELETE_ERROR = '不能删除笔记根目录。'
const NOTE_PATH_LABEL = '笔记路径'
const NOTE_PARENT_LABEL = '笔记父目录'
const NOTE_NAME_LABEL = '笔记名称'
const NOTE_SEARCH_QUERY_LABEL = '笔记搜索关键词'
const NOTE_CONTENT_REQUIRED_ERROR = '笔记内容不能为空。'
const NOTE_OUTSIDE_ROOT_SUFFIX = '解析到了笔记目录之外。请检查路径是否包含上级目录或符号链接。'
const NOTE_SEARCH_LIMIT_TYPE_ERROR = '笔记搜索数量必须是数字。'
const NOTE_LIST_LIMIT_TYPE_ERROR = '笔记列表数量必须是数字。'
const NOTE_LIST_OFFSET_TYPE_ERROR = '笔记列表偏移量必须是数字。'
const NOTE_READ_MAX_BYTES_TYPE_ERROR = '笔记读取字节数上限必须是数字。'

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(NOTES_INPUT_OBJECT_ERROR)
  return input as Record<string, unknown>
}

function throwIfNotesSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error(NOTES_ABORT_ERROR)
}

async function getNotesRoot(signal?: AbortSignal) {
  throwIfNotesSignalAborted(signal)
  const preferredPath = await Promise.resolve()
    .then(() => application.get('PreferenceService').get('feature.notes.path'))
    .catch(() => '')
  throwIfNotesSignalAborted(signal)
  if (typeof preferredPath === 'string' && preferredPath.trim()) return path.resolve(preferredPath.trim())

  const noteState = await readRendererStoreValue<any>('state.note', {
    checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
    signal
  }).catch(() => null)
  throwIfNotesSignalAborted(signal)
  return path.resolve(noteState?.notesPath || getNotesDir())
}

function normalizeOptionalText(value: unknown, label = '输入值', fallback = '') {
  if (typeof value === 'string') return value.trim()
  if (value === null || typeof value === 'undefined') return fallback
  throw new Error(label + ' 必须是字符串。')
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value, label)
  if (!text) throw new Error(label + ' 不能为空。')
  return text
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

function assertNotNotesRoot(root: string, target: string) {
  if (path.resolve(root) === path.resolve(target)) {
    throw new Error(NOTES_ROOT_DELETE_ERROR)
  }
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

async function assertResolvedInsideNotesRoot(root: string, target: string, label = NOTE_PATH_LABEL) {
  const realRoot = await realpathOrResolvedPath(root)
  const realTarget = await resolveRealPathPreservingMissingSegments(target)
  if (!isPathInsideOrEqual(realTarget, realRoot)) {
    throw new Error(label + NOTE_OUTSIDE_ROOT_SUFFIX)
  }
}

async function resolveNoteDeleteTarget(root: string, input: string) {
  const target = resolveInsideRoot(root, input)
  if (path.extname(target) || (await fs.stat(target).catch(() => null))) {
    return target
  }

  const markdownTarget = `${target}.md`
  const markdownStat = await fs.stat(markdownTarget).catch(() => null)
  return markdownStat?.isFile() ? markdownTarget : target
}

function normalizeSearchLimit(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'Note search limit',
    defaultValue: DEFAULT_NOTE_SEARCH_LIMIT,
    min: 1,
    max: MAX_NOTE_SEARCH_LIMIT,
    invalidTypeMessage: NOTE_SEARCH_LIMIT_TYPE_ERROR
  })
}

function normalizeListLimit(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'Note list limit',
    defaultValue: DEFAULT_NOTE_LIST_LIMIT,
    min: 1,
    max: MAX_NOTE_LIST_LIMIT,
    invalidTypeMessage: NOTE_LIST_LIMIT_TYPE_ERROR
  })
}

function normalizeOffset(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'Note list offset',
    defaultValue: 0,
    min: 0,
    invalidTypeMessage: NOTE_LIST_OFFSET_TYPE_ERROR
  })
}

function normalizeReadMaxBytes(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'Note read maxBytes',
    defaultValue: DEFAULT_NOTE_READ_MAX_BYTES,
    min: 1,
    max: MAX_NOTE_READ_MAX_BYTES,
    invalidTypeMessage: NOTE_READ_MAX_BYTES_TYPE_ERROR
  })
}

async function readTextFilePreview(filePath: string, maxBytes: number, signal?: AbortSignal) {
  throwIfNotesSignalAborted(signal)
  const stat = await fs.stat(filePath)
  throwIfNotesSignalAborted(signal)
  if (stat.size <= maxBytes) {
    const content = await fs.readFile(filePath, { encoding: 'utf8', signal })
    throwIfNotesSignalAborted(signal)
    return {
      content,
      byteSize: stat.size,
      truncated: false,
      maxBytes
    }
  }

  const handle = await fs.open(filePath, 'r')
  try {
    throwIfNotesSignalAborted(signal)
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    throwIfNotesSignalAborted(signal)
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

async function listNoteEntries(root: string, input: any, signal?: AbortSignal) {
  const limit = normalizeListLimit(input?.limit)
  const offset = normalizeOffset(input?.offset)
  const collected: any[] = []
  const stack = [{ dirPath: root, depth: 0 }]
  let skipped = 0
  let scannedEntries = 0
  let hitScanLimit = false

  while (stack.length > 0 && collected.length <= limit) {
    throwIfNotesSignalAborted(signal)
    const current = stack.pop()!
    const entries = await fs.readdir(current.dirPath, { withFileTypes: true }).catch(() => [])
    throwIfNotesSignalAborted(signal)
    const childDirectories: Array<{ dirPath: string; depth: number }> = []

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
      throwIfNotesSignalAborted(signal)
      if (entry.name.startsWith('.')) continue
      scannedEntries += 1
      if (scannedEntries > MAX_NOTE_LIST_SCAN_ENTRIES) {
        hitScanLimit = true
        break
      }

      const entryPath = path.join(current.dirPath, entry.name)
      const relativePath = path.relative(root, entryPath).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        const stats = await fs.stat(entryPath).catch(() => null)
        throwIfNotesSignalAborted(signal)
        const item = {
          type: 'folder',
          name: entry.name,
          treePath: `/${relativePath}`,
          externalPath: entryPath,
          updatedAt: stats?.mtime.toISOString() ?? null
        }
        if (skipped < offset) {
          skipped += 1
        } else {
          collected.push(item)
        }
        if (current.depth < MAX_NOTE_LIST_DEPTH) {
          childDirectories.push({ dirPath: entryPath, depth: current.depth + 1 })
        }
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        const stats = await fs.stat(entryPath).catch(() => null)
        throwIfNotesSignalAborted(signal)
        const treePath = `/${relativePath.replace(/\.md$/i, '')}`
        const item = {
          type: 'file',
          name: path.basename(entry.name, path.extname(entry.name)),
          treePath,
          externalPath: entryPath,
          byteSize: stats?.size ?? null,
          updatedAt: stats?.mtime.toISOString() ?? null
        }
        if (skipped < offset) {
          skipped += 1
        } else {
          collected.push(item)
        }
      }

      if (collected.length > limit) break
    }

    for (const child of childDirectories.reverse()) {
      stack.push(child)
    }

    if (hitScanLimit) break
  }

  const hasMore = collected.length > limit || stack.length > 0 || hitScanLimit
  return {
    notes: collected.slice(0, limit),
    limit,
    offset,
    nextOffset: hasMore ? offset + limit : null,
    truncated: hasMore,
    scannedEntries,
    scanLimit: MAX_NOTE_LIST_SCAN_ENTRIES,
    scanLimitReached: hitScanLimit
  }
}

async function collectNoteFilesForSearch(root: string, signal?: AbortSignal) {
  const files: any[] = []
  const stack = [{ dirPath: root, depth: 0 }]
  let scannedEntries = 0
  let hitScanLimit = false

  while (stack.length > 0 && files.length < MAX_NOTE_SEARCH_FILES) {
    throwIfNotesSignalAborted(signal)
    const current = stack.pop()!
    const entries = await fs.readdir(current.dirPath, { withFileTypes: true }).catch(() => [])
    throwIfNotesSignalAborted(signal)
    const childDirectories: Array<{ dirPath: string; depth: number }> = []

    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
      throwIfNotesSignalAborted(signal)
      if (entry.name.startsWith('.')) continue
      scannedEntries += 1
      if (scannedEntries > MAX_NOTE_LIST_SCAN_ENTRIES) {
        hitScanLimit = true
        break
      }

      const entryPath = path.join(current.dirPath, entry.name)
      const relativePath = path.relative(root, entryPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (current.depth < MAX_NOTE_LIST_DEPTH) {
          childDirectories.push({ dirPath: entryPath, depth: current.depth + 1 })
        }
        continue
      }

      if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        files.push({
          type: 'file',
          name: path.basename(entry.name, path.extname(entry.name)),
          treePath: `/${relativePath.replace(/\.md$/i, '')}`,
          externalPath: entryPath
        })
      }

      if (files.length >= MAX_NOTE_SEARCH_FILES) {
        hitScanLimit = true
        break
      }
    }

    for (const child of childDirectories.reverse()) {
      stack.push(child)
    }

    if (hitScanLimit) break
  }

  return {
    files,
    scannedEntries,
    scanTruncated: hitScanLimit || stack.length > 0
  }
}

export function createNotesCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'notes.list',
      domain: 'notes',
      kind: 'query',
      title: 'List notes',
      description: 'List notes from the configured notes directory.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: DEFAULT_NOTE_LIST_LIMIT },
          offset: { type: 'number', default: 0 }
        }
      },
      risk: 'read',
      tags: ['notes', 'files', 'markdown'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        throwIfNotesSignalAborted(context.signal)
        const root = await getNotesRoot(context.signal)
        const entries = await listNoteEntries(root, inputObject, context.signal)
        throwIfNotesSignalAborted(context.signal)
        return okResult('Notes listed', { root, ...entries })
      }
    },
    {
      id: 'notes.read',
      domain: 'notes',
      kind: 'query',
      title: 'Read note',
      description: 'Read a markdown note by path within the configured notes directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Note path relative to the notes root' },
          maxBytes: {
            type: 'number',
            default: DEFAULT_NOTE_READ_MAX_BYTES,
            description: 'Maximum UTF-8 bytes to return before truncating the note preview'
          }
        },
        required: ['path']
      },
      risk: 'read',
      tags: ['notes', 'read', 'markdown'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const notePath = normalizeRequiredText(inputObject.path, NOTE_PATH_LABEL)
        throwIfNotesSignalAborted(context.signal)
        const root = await getNotesRoot(context.signal)
        const filePath = resolveInsideRoot(root, notePath, '.md')
        await assertResolvedInsideNotesRoot(root, filePath)
        throwIfNotesSignalAborted(context.signal)
        const preview = await readTextFilePreview(filePath, normalizeReadMaxBytes(inputObject.maxBytes), context.signal)
        throwIfNotesSignalAborted(context.signal)
        return okResult('Note read', {
          path: filePath,
          ...preview
        })
      }
    },
    {
      id: 'notes.search',
      domain: 'notes',
      kind: 'query',
      title: 'Search notes',
      description: 'Search note file names and markdown contents.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive search query' },
          limit: { type: 'number', default: 100 }
        },
        required: ['query']
      },
      risk: 'read',
      tags: ['notes', 'search', 'markdown'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const query = normalizeRequiredText(inputObject.query, NOTE_SEARCH_QUERY_LABEL).toLowerCase()

        throwIfNotesSignalAborted(context.signal)
        const root = await getNotesRoot(context.signal)
        const limit = normalizeSearchLimit(inputObject.limit)
        const { files, scanTruncated } = await collectNoteFilesForSearch(root, context.signal)
        const matches: any[] = []
        for (const file of files) {
          throwIfNotesSignalAborted(context.signal)
          if (matches.length >= limit) break
          const nameMatches = file.name.toLowerCase().includes(query)
          const stat = await fs.stat(file.externalPath).catch(() => null)
          throwIfNotesSignalAborted(context.signal)
          if (!stat?.isFile()) continue
          if (nameMatches) {
            matches.push({ ...file, byteSize: stat.size, match: 'name', snippet: '' })
            continue
          }
          if (stat.size > MAX_NOTE_SEARCH_FILE_BYTES) continue

          const content = await fs
            .readFile(file.externalPath, { encoding: 'utf8', signal: context.signal })
            .catch(() => '')
          throwIfNotesSignalAborted(context.signal)
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
        throwIfNotesSignalAborted(context.signal)
        return okResult('Notes searched', {
          query,
          root,
          matches,
          scannedFiles: files.length,
          scanTruncated
        })
      }
    },
    {
      id: 'notes.create',
      domain: 'notes',
      kind: 'command',
      title: 'Create note',
      description: 'Create a markdown note in the configured notes directory.',
      inputSchema: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Parent directory relative to notes root' },
          name: { type: 'string', description: 'Note name without extension' },
          content: { type: 'string', description: 'Markdown content' }
        },
        required: ['name']
      },
      risk: 'write',
      permissions: ['notes.write'],
      sideEffects: ['filesystem.write'],
      tags: ['notes', 'create', 'markdown'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const parentInput = normalizeOptionalText(inputObject.parent, NOTE_PARENT_LABEL)
        const nameInput = normalizeOptionalText(inputObject.name, NOTE_NAME_LABEL, 'Untitled') || 'Untitled'
        const content = normalizeNoteContent(inputObject.content)
        throwIfNotesSignalAborted(context.signal)
        const root = await getNotesRoot(context.signal)
        const parent = resolveInsideRoot(root, parentInput)
        await assertResolvedInsideNotesRoot(root, parent, NOTE_PARENT_LABEL)
        throwIfNotesSignalAborted(context.signal)
        await fs.mkdir(parent, { recursive: true })
        throwIfNotesSignalAborted(context.signal)
        const safeName = getName(parent, nameInput, true)
        const filePath = path.join(parent, `${safeName}.md`)
        await assertResolvedInsideNotesRoot(root, filePath)
        throwIfNotesSignalAborted(context.signal)
        await fs.writeFile(filePath, content, { encoding: 'utf8', signal: context.signal })
        notifyMainProcessDataSyncLocalChange('file', { source: 'app-capability.notes.create', path: filePath })
        throwIfNotesSignalAborted(context.signal)
        return {
          ok: true,
          summary: `Note created: ${safeName}`,
          data: { path: filePath, name: safeName },
          artifacts: [{ type: 'note', path: filePath, title: safeName }]
        }
      }
    },
    {
      id: 'notes.write',
      domain: 'notes',
      kind: 'command',
      title: 'Write note',
      description: 'Overwrite a markdown note inside the configured notes directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Note path relative to notes root' },
          content: { type: 'string', description: 'Markdown content' }
        },
        required: ['path', 'content']
      },
      risk: 'write',
      permissions: ['notes.write'],
      sideEffects: ['filesystem.write'],
      tags: ['notes', 'write', 'markdown'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        if (!Object.prototype.hasOwnProperty.call(inputObject, 'content')) throw new Error(NOTE_CONTENT_REQUIRED_ERROR)
        const notePath = normalizeRequiredText(inputObject.path, NOTE_PATH_LABEL)
        const content = normalizeNoteContent(inputObject.content)
        throwIfNotesSignalAborted(context.signal)
        const root = await getNotesRoot(context.signal)
        const filePath = resolveInsideRoot(root, notePath, '.md')
        await assertResolvedInsideNotesRoot(root, filePath)
        throwIfNotesSignalAborted(context.signal)
        const parent = path.dirname(filePath)
        await assertResolvedInsideNotesRoot(root, parent, NOTE_PARENT_LABEL)
        throwIfNotesSignalAborted(context.signal)
        await fs.mkdir(parent, { recursive: true })
        throwIfNotesSignalAborted(context.signal)
        await fs.writeFile(filePath, content, { encoding: 'utf8', signal: context.signal })
        notifyMainProcessDataSyncLocalChange('file', { source: 'app-capability.notes.write', path: filePath })
        throwIfNotesSignalAborted(context.signal)
        return okResult('Note written', { path: filePath })
      }
    },
    {
      id: 'notes.delete',
      domain: 'notes',
      kind: 'command',
      title: 'Delete note',
      description: 'Delete a note or notes subdirectory inside the configured notes directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to notes root' }
        },
        required: ['path']
      },
      risk: 'destructive',
      permissions: ['notes.delete'],
      sideEffects: ['filesystem.delete'],
      supportsDryRun: true,
      tags: ['notes', 'delete'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const notePath = normalizeRequiredText(inputObject.path, NOTE_PATH_LABEL)
        throwIfNotesSignalAborted(context.signal)
        const root = await getNotesRoot(context.signal)
        const target = await resolveNoteDeleteTarget(root, notePath)
        assertNotNotesRoot(root, target)
        await assertResolvedInsideNotesRoot(root, target)
        throwIfNotesSignalAborted(context.signal)
        if (context.dryRun) return okResult('Note delete dry run completed', { path: target })
        await fs.rm(target, { force: true, recursive: true })
        notifyMainProcessDataSyncLocalChange('file', { source: 'app-capability.notes.delete', path: target })
        throwIfNotesSignalAborted(context.signal)
        return okResult('Note deleted', { path: target })
      }
    }
  ]
}
