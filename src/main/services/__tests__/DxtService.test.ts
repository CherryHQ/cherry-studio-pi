import fs from 'node:fs'

import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { ...actual, default: actual }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, default: actual }
})

import {
  ensurePathWithin,
  migrateLegacyMcpDirectory,
  resolveDxtPackagePath,
  validateArgs,
  validateCommand
} from '../DxtService'

describe('ensurePathWithin', () => {
  // Use path.join to construct cross-platform compatible paths
  const baseDir = path.join('/', 'home', 'user', 'mcp')

  describe('valid paths', () => {
    // Skip these tests on Windows as path behavior differs significantly
    const testFn = process.platform === 'win32' ? it.skip : it

    testFn('should accept direct child paths', () => {
      const target1 = path.join('/', 'home', 'user', 'mcp', 'server-test')
      const target2 = path.join('/', 'home', 'user', 'mcp', 'my-server')
      expect(ensurePathWithin(baseDir, target1)).toBe(path.resolve(target1))
      expect(ensurePathWithin(baseDir, target2)).toBe(path.resolve(target2))
    })

    testFn('should accept paths with unicode characters', () => {
      const target1 = path.join('/', 'home', 'user', 'mcp', '服务器')
      const target2 = path.join('/', 'home', 'user', 'mcp', 'サーバー')
      expect(ensurePathWithin(baseDir, target1)).toBe(path.resolve(target1))
      expect(ensurePathWithin(baseDir, target2)).toBe(path.resolve(target2))
    })
  })

  describe('path traversal prevention', () => {
    it('should reject paths that escape base directory', () => {
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', '..', '..', '..', 'etc'))).toThrow(
        'Path traversal detected'
      )
      expect(() => ensurePathWithin(baseDir, '/etc/passwd')).toThrow('Path traversal detected')
      expect(() => ensurePathWithin(baseDir, '/home/user')).toThrow('Path traversal detected')
    })

    it('should reject subdirectories', () => {
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', 'sub', 'dir'))).toThrow(
        'Path traversal detected'
      )
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', 'a', 'b', 'c'))).toThrow(
        'Path traversal detected'
      )
    })

    it('should reject Windows-style path traversal', () => {
      const winBase = 'C:\\Users\\user\\mcp'
      expect(() => ensurePathWithin(winBase, 'C:\\Users\\user\\mcp\\..\\..\\Windows\\System32')).toThrow(
        'Path traversal detected'
      )
    })

    it('should reject null byte attacks', () => {
      const maliciousPath = path.join(baseDir, 'server\x00/../../../etc/passwd')
      expect(() => ensurePathWithin(baseDir, maliciousPath)).toThrow('Path traversal detected')
    })

    it('should handle encoded traversal attempts', () => {
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', '..', 'escape'))).toThrow(
        'Path traversal detected'
      )
    })
  })

  describe('edge cases', () => {
    it('should reject base directory itself', () => {
      expect(() => ensurePathWithin(baseDir, baseDir)).toThrow('Path traversal detected')
    })

    // Skip this test on Windows
    const testFn = process.platform === 'win32' ? it.skip : it

    testFn('should handle relative path construction', () => {
      const target = path.join(baseDir, 'server-name')
      expect(ensurePathWithin(baseDir, target)).toBe(path.resolve(target))
    })
  })
})

describe('validateCommand', () => {
  describe('valid commands', () => {
    it('should accept simple command names', () => {
      expect(validateCommand('node')).toBe('node')
      expect(validateCommand('python')).toBe('python')
      expect(validateCommand('npx')).toBe('npx')
      expect(validateCommand('uvx')).toBe('uvx')
    })

    it('should accept absolute paths', () => {
      expect(validateCommand('/usr/bin/node')).toBe('/usr/bin/node')
      expect(validateCommand('/usr/local/bin/python3')).toBe('/usr/local/bin/python3')
      expect(validateCommand('C:\\Program Files\\nodejs\\node.exe')).toBe('C:\\Program Files\\nodejs\\node.exe')
    })

    it('should accept relative paths starting with ./', () => {
      expect(validateCommand('./node_modules/.bin/tsc')).toBe('./node_modules/.bin/tsc')
      expect(validateCommand('.\\scripts\\run.bat')).toBe('.\\scripts\\run.bat')
    })

    it('should trim whitespace', () => {
      expect(validateCommand('  node  ')).toBe('node')
      expect(validateCommand('\tpython\n')).toBe('python')
    })
  })

  describe('path traversal prevention', () => {
    it('should reject commands with path traversal (Unix style)', () => {
      expect(() => validateCommand('../../../bin/sh')).toThrow('path traversal detected')
      expect(() => validateCommand('../../etc/passwd')).toThrow('path traversal detected')
      expect(() => validateCommand('/usr/../../../bin/sh')).toThrow('path traversal detected')
    })

    it('should reject commands with path traversal (Windows style)', () => {
      expect(() => validateCommand('..\\..\\..\\Windows\\System32\\cmd.exe')).toThrow('path traversal detected')
      expect(() => validateCommand('..\\..\\Windows\\System32\\calc.exe')).toThrow('path traversal detected')
      expect(() => validateCommand('C:\\..\\..\\Windows\\System32\\cmd.exe')).toThrow('path traversal detected')
    })

    it('should reject just ".."', () => {
      expect(() => validateCommand('..')).toThrow('path traversal detected')
    })

    it('should reject mixed style path traversal', () => {
      expect(() => validateCommand('../..\\mixed/..\\attack')).toThrow('path traversal detected')
    })
  })

  describe('null byte injection', () => {
    it('should reject commands with null bytes', () => {
      expect(() => validateCommand('node\x00.exe')).toThrow('null byte detected')
      expect(() => validateCommand('python\0')).toThrow('null byte detected')
    })
  })

  describe('edge cases', () => {
    it('should reject empty strings', () => {
      expect(() => validateCommand('')).toThrow('command must be a non-empty string')
      expect(() => validateCommand('   ')).toThrow('command cannot be empty')
    })

    it('should reject non-string input', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => validateCommand(null)).toThrow('command must be a non-empty string')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateCommand(undefined)).toThrow('command must be a non-empty string')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateCommand(123)).toThrow('command must be a non-empty string')
    })
  })

  describe('real-world attack scenarios', () => {
    it('should prevent Windows system32 command injection', () => {
      expect(() => validateCommand('../../../../Windows/System32/cmd.exe')).toThrow('path traversal detected')
      expect(() => validateCommand('..\\..\\..\\..\\Windows\\System32\\powershell.exe')).toThrow(
        'path traversal detected'
      )
    })

    it('should prevent Unix bin injection', () => {
      expect(() => validateCommand('../../../../bin/bash')).toThrow('path traversal detected')
      expect(() => validateCommand('../../../usr/bin/curl')).toThrow('path traversal detected')
    })
  })
})

describe('validateArgs', () => {
  describe('valid arguments', () => {
    it('should accept normal arguments', () => {
      expect(validateArgs(['--version'])).toEqual(['--version'])
      expect(validateArgs(['-y', '@anthropic/mcp-server'])).toEqual(['-y', '@anthropic/mcp-server'])
      expect(validateArgs(['install', 'package-name'])).toEqual(['install', 'package-name'])
    })

    it('should accept arguments with safe paths', () => {
      expect(validateArgs(['./src/index.ts'])).toEqual(['./src/index.ts'])
      expect(validateArgs(['/absolute/path/file.js'])).toEqual(['/absolute/path/file.js'])
    })

    it('should accept empty array', () => {
      expect(validateArgs([])).toEqual([])
    })
  })

  describe('path traversal prevention', () => {
    it('should reject arguments with path traversal', () => {
      expect(() => validateArgs(['../../../etc/passwd'])).toThrow('path traversal detected')
      expect(() => validateArgs(['--config', '../../secrets.json'])).toThrow('path traversal detected')
      expect(() => validateArgs(['..\\..\\Windows\\System32\\config'])).toThrow('path traversal detected')
    })

    it('should only check path-like arguments', () => {
      // Arguments without path separators should pass even with dots
      expect(validateArgs(['..version'])).toEqual(['..version'])
      expect(validateArgs(['test..name'])).toEqual(['test..name'])
    })
  })

  describe('null byte injection', () => {
    it('should reject arguments with null bytes', () => {
      expect(() => validateArgs(['file\x00.txt'])).toThrow('null byte detected')
      expect(() => validateArgs(['--config', 'path\0name'])).toThrow('null byte detected')
    })
  })

  describe('edge cases', () => {
    it('should reject non-array input', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs('not an array')).toThrow('must be an array')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs(null)).toThrow('must be an array')
    })

    it('should reject non-string elements', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs([123])).toThrow('must be a string')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs(['valid', null])).toThrow('must be a string')
    })
  })
})

describe('migrateLegacyMcpDirectory', () => {
  let tmpDir: string | null = null
  const tmpRoot = process.env.TMPDIR || '/tmp'

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('copies legacy DXT server packages into the Storage v2 MCP directory', () => {
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'dxt-mcp-migrate-'))
    const legacyDir = path.join(tmpDir, 'home-mcp')
    const targetDir = path.join(tmpDir, 'Data', 'MCP')

    fs.mkdirSync(path.join(legacyDir, 'server-demo'), { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'server-demo', 'manifest.json'), '{"name":"demo"}')

    const migrated = migrateLegacyMcpDirectory(legacyDir, targetDir)

    expect(migrated).toEqual(['server-demo'])
    expect(fs.readFileSync(path.join(targetDir, 'server-demo', 'manifest.json'), 'utf-8')).toBe('{"name":"demo"}')
  })

  it('keeps existing Storage v2 MCP entries authoritative during legacy migration', () => {
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'dxt-mcp-migrate-'))
    const legacyDir = path.join(tmpDir, 'home-mcp')
    const targetDir = path.join(tmpDir, 'Data', 'MCP')

    fs.mkdirSync(path.join(legacyDir, 'server-demo'), { recursive: true })
    fs.mkdirSync(path.join(targetDir, 'server-demo'), { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'server-demo', 'manifest.json'), '{"name":"legacy"}')
    fs.writeFileSync(path.join(targetDir, 'server-demo', 'manifest.json'), '{"name":"storage-v2"}')

    const migrated = migrateLegacyMcpDirectory(legacyDir, targetDir)

    expect(migrated).toEqual([])
    expect(fs.readFileSync(path.join(targetDir, 'server-demo', 'manifest.json'), 'utf-8')).toBe('{"name":"storage-v2"}')
  })
})

describe('resolveDxtPackagePath', () => {
  let tmpDir: string | null = null
  const tmpRoot = process.env.TMPDIR || '/tmp'

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('redirects legacy DXT paths to the restored Storage v2 package directory', () => {
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'dxt-path-resolve-'))
    const legacyDir = path.join(tmpDir, 'home-mcp')
    const targetDir = path.join(tmpDir, 'Data', 'MCP')
    const restoredPath = path.join(targetDir, 'server-demo')

    fs.mkdirSync(restoredPath, { recursive: true })

    expect(resolveDxtPackagePath(path.join(legacyDir, 'server-demo'), targetDir, legacyDir)).toBe(restoredPath)
  })

  it('falls back to the server name when the stored DXT path uses an old directory name', () => {
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'dxt-path-resolve-'))
    const legacyDir = path.join(tmpDir, 'home-mcp')
    const targetDir = path.join(tmpDir, 'Data', 'MCP')
    const restoredPath = path.join(targetDir, 'server-demo')

    fs.mkdirSync(restoredPath, { recursive: true })

    expect(resolveDxtPackagePath(path.join(legacyDir, 'old-demo'), targetDir, legacyDir, 'demo')).toBe(restoredPath)
  })

  it('keeps the stored path when no restored package exists', () => {
    const storedPath = '/missing/home-mcp/server-demo'
    expect(resolveDxtPackagePath(storedPath, '/missing/Data/MCP', '/missing/home-mcp')).toBe(storedPath)
  })
})
