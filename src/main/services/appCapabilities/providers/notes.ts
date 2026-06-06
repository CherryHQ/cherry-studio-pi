import fs from 'node:fs/promises'
import path from 'node:path'

import { reduxService } from '@main/services/ReduxService'
import { getName, getNotesDir } from '@main/utils/file'

import type { AppCapabilityDefinition } from '../types'
import { okResult, resolveInsideRoot } from '../utils'

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

async function getNotesRoot() {
  const noteState = await reduxService.select<any>('state.note').catch(() => null)
  return path.resolve(noteState?.notesPath || getNotesDir())
}

function normalizeSearchLimit(value: unknown) {
  const parsed =
    typeof value === 'string' && !value.trim() ? DEFAULT_NOTE_SEARCH_LIMIT : Number(value ?? DEFAULT_NOTE_SEARCH_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_NOTE_SEARCH_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_NOTE_SEARCH_LIMIT))
}

function normalizeListLimit(value: unknown) {
  const parsed =
    typeof value === 'string' && !value.trim() ? DEFAULT_NOTE_LIST_LIMIT : Number(value ?? DEFAULT_NOTE_LIST_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_NOTE_LIST_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_NOTE_LIST_LIMIT))
}

function normalizeOffset(value: unknown) {
  const parsed = typeof value === 'string' && !value.trim() ? 0 : Number(value ?? 0)
  const safeOffset = Number.isFinite(parsed) ? Math.trunc(parsed) : 0
  return Math.max(0, safeOffset)
}

function normalizeReadMaxBytes(value: unknown) {
  const parsed =
    typeof value === 'string' && !value.trim()
      ? DEFAULT_NOTE_READ_MAX_BYTES
      : Number(value ?? DEFAULT_NOTE_READ_MAX_BYTES)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_NOTE_READ_MAX_BYTES
  return Math.max(1, Math.min(safeLimit, MAX_NOTE_READ_MAX_BYTES))
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

async function listNoteEntries(root: string, input: any) {
  const limit = normalizeListLimit(input?.limit)
  const offset = normalizeOffset(input?.offset)
  const collected: any[] = []
  const stack = [{ dirPath: root, depth: 0 }]
  let skipped = 0
  let scannedEntries = 0
  let hitScanLimit = false

  while (stack.length > 0 && collected.length <= limit) {
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
      if (scannedEntries > MAX_NOTE_LIST_SCAN_ENTRIES) {
        hitScanLimit = true
        break
      }

      const entryPath = path.join(current.dirPath, entry.name)
      const relativePath = path.relative(root, entryPath).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        const stats = await fs.stat(entryPath).catch(() => null)
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

async function collectNoteFilesForSearch(root: string) {
  const files: any[] = []
  const stack = [{ dirPath: root, depth: 0 }]
  let scannedEntries = 0
  let hitScanLimit = false

  while (stack.length > 0 && files.length < MAX_NOTE_SEARCH_FILES) {
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
      execute: async (input: any) => {
        const root = await getNotesRoot()
        return okResult('Notes listed', { root, ...(await listNoteEntries(root, input)) })
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
      execute: async (input: any) => {
        const root = await getNotesRoot()
        const filePath = resolveInsideRoot(root, String(input?.path || ''), '.md')
        return okResult('Note read', {
          path: filePath,
          ...(await readTextFilePreview(filePath, normalizeReadMaxBytes(input?.maxBytes)))
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
      execute: async (input: any) => {
        const query = String(input?.query || '')
          .trim()
          .toLowerCase()
        if (!query) throw new Error('Missing search query')

        const root = await getNotesRoot()
        const limit = normalizeSearchLimit(input?.limit)
        const { files, scanTruncated } = await collectNoteFilesForSearch(root)
        const matches: any[] = []
        for (const file of files) {
          if (matches.length >= limit) break
          const nameMatches = file.name.toLowerCase().includes(query)
          const stat = await fs.stat(file.externalPath).catch(() => null)
          if (!stat?.isFile()) continue
          if (nameMatches) {
            matches.push({ ...file, byteSize: stat.size, match: 'name', snippet: '' })
            continue
          }
          if (stat.size > MAX_NOTE_SEARCH_FILE_BYTES) continue

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
      execute: async (input: any) => {
        const root = await getNotesRoot()
        const parent = resolveInsideRoot(root, input?.parent || '')
        await fs.mkdir(parent, { recursive: true })
        const safeName = getName(parent, input?.name || 'Untitled', true)
        const filePath = path.join(parent, `${safeName}.md`)
        await fs.writeFile(filePath, input?.content || '', 'utf8')
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
      execute: async (input: any) => {
        const root = await getNotesRoot()
        const filePath = resolveInsideRoot(root, input?.path, '.md')
        await fs.writeFile(filePath, input?.content || '', 'utf8')
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
      tags: ['notes', 'delete'],
      execute: async (input: any, context) => {
        const root = await getNotesRoot()
        const target = resolveInsideRoot(root, String(input?.path || ''))
        if (context.dryRun) return okResult('Note delete dry run completed', { path: target })
        await fs.rm(target, { force: true, recursive: true })
        return okResult('Note deleted', { path: target })
      }
    }
  ]
}
