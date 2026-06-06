import fs from 'node:fs/promises'
import path from 'node:path'

import { reduxService } from '@main/services/ReduxService'
import { getName, getNotesDir, scanDir } from '@main/utils/file'

import type { AppCapabilityDefinition } from '../types'
import { okResult, resolveInsideRoot } from '../utils'

const DEFAULT_NOTE_SEARCH_LIMIT = 100
const MAX_NOTE_SEARCH_LIMIT = 200
const MAX_NOTE_SEARCH_FILES = 5_000
const MAX_NOTE_SEARCH_FILE_BYTES = 512 * 1024

async function getNotesRoot() {
  const noteState = await reduxService.select<any>('state.note').catch(() => null)
  return path.resolve(noteState?.notesPath || getNotesDir())
}

function flattenNotes(nodes: any[], result: any[] = []) {
  for (const node of nodes) {
    if (node.type === 'file') result.push(node)
    if (node.children) flattenNotes(node.children, result)
  }
  return result
}

function normalizeSearchLimit(value: unknown) {
  const parsed = Number(value ?? DEFAULT_NOTE_SEARCH_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? parsed : DEFAULT_NOTE_SEARCH_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_NOTE_SEARCH_LIMIT))
}

export function createNotesCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'notes.list',
      domain: 'notes',
      kind: 'query',
      title: 'List notes',
      description: 'List notes from the configured notes directory.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['notes', 'files', 'markdown'],
      execute: async () => {
        const root = await getNotesRoot()
        return okResult('Notes listed', { root, notes: await scanDir(root) })
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
          path: { type: 'string', description: 'Note path relative to the notes root' }
        },
        required: ['path']
      },
      risk: 'read',
      tags: ['notes', 'read', 'markdown'],
      execute: async (input: any) => {
        const root = await getNotesRoot()
        const filePath = resolveInsideRoot(root, String(input?.path || ''), '.md')
        return okResult('Note read', { path: filePath, content: await fs.readFile(filePath, 'utf8') })
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
        const files = flattenNotes(await scanDir(root)).slice(0, MAX_NOTE_SEARCH_FILES)
        const matches: any[] = []
        for (const file of files) {
          if (matches.length >= limit) break
          const stat = await fs.stat(file.externalPath).catch(() => null)
          if (!stat?.isFile() || stat.size > MAX_NOTE_SEARCH_FILE_BYTES) continue
          const content = await fs.readFile(file.externalPath, 'utf8').catch(() => '')
          const index = content.toLowerCase().indexOf(query)
          if (index >= 0 || file.name.toLowerCase().includes(query)) {
            matches.push({ ...file, snippet: content.slice(Math.max(index - 80, 0), index + 180) })
          }
        }
        return okResult('Notes searched', {
          query,
          root,
          matches,
          scannedFiles: files.length,
          scanTruncated: files.length >= MAX_NOTE_SEARCH_FILES
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
