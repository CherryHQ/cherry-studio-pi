import type { SlashCommand } from '@shared/ai/slashCommands'

export type BuiltinPiTool = {
  id: string
  name: string
  description: string
  requirePermissions: boolean
  type: 'builtin'
}

export const builtinTools: BuiltinPiTool[] = [
  {
    id: 'Bash',
    name: 'Bash',
    description: 'Executes shell commands in your environment',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'Edit',
    name: 'Edit',
    description: 'Makes targeted edits to specific files',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'Glob',
    name: 'Glob',
    description: 'Finds files based on pattern matching',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'Grep',
    name: 'Grep',
    description: 'Searches for patterns in file contents',
    requirePermissions: false,
    type: 'builtin'
  },
  { id: 'Read', name: 'Read', description: 'Reads the contents of files', requirePermissions: false, type: 'builtin' },
  { id: 'Write', name: 'Write', description: 'Creates or overwrites files', requirePermissions: true, type: 'builtin' },
  {
    id: 'HTTPRequest',
    name: 'HTTPRequest',
    description: 'Sends HTTP requests and returns response status, headers, and body preview',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'AppSearchCapabilities',
    name: 'AppSearchCapabilities',
    description: 'Searches Cherry Studio Pi internal app capabilities',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'AppCallCapability',
    name: 'AppCallCapability',
    description: 'Calls a Cherry Studio Pi internal app capability directly',
    requirePermissions: false,
    type: 'builtin'
  },
  {
    id: 'BrowserOpen',
    name: 'BrowserOpen',
    description: 'Opens a URL in the browser automation session',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'BrowserExecute',
    name: 'BrowserExecute',
    description: 'Executes JavaScript in the active browser automation page',
    requirePermissions: true,
    type: 'builtin'
  },
  {
    id: 'BrowserReset',
    name: 'BrowserReset',
    description: 'Resets the browser automation session',
    requirePermissions: true,
    type: 'builtin'
  }
]

export const builtinSlashCommands: SlashCommand[] = []
