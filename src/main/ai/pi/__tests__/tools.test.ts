import fs from 'node:fs/promises'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  default: {},
  app: { on: vi.fn(), getPath: vi.fn(() => '/tmp') },
  BrowserWindow: vi.fn(),
  BrowserView: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  nativeTheme: { themeSource: 'system' },
  net: { fetch: vi.fn() },
  session: { defaultSession: {} }
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {}
}))

vi.mock('@main/services/MCPService', () => ({
  default: {
    listAllActiveServerTools: vi.fn(),
    listActiveServerToolsByIds: vi.fn(),
    callToolById: vi.fn()
  }
}))

vi.mock('@main/services/appCapabilities', () => ({
  appCapabilityService: {
    list: vi.fn(),
    search: vi.fn(),
    call: vi.fn()
  }
}))

vi.mock('@main/services/agents/services/ToolPermissionService', () => ({
  promptForToolApproval: vi.fn(async () => ({ behavior: 'allow' }))
}))

import { promptForToolApproval } from '@main/services/agents/services/ToolPermissionService'
import { appCapabilityService } from '@main/services/appCapabilities'
import mcpService from '@main/services/MCPService'
import { net } from 'electron'

import { builtinTools } from '../builtin'
import { buildPiBashShellInvocation, createPiMcpTools, createPiTools } from '../tools'

const getTool = (name: string, cwd: string, roots: string[]) => {
  const tool = createPiTools(cwd, roots).find((item) => item.name === name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool
}

const resultText = (result: any) => result.content?.[0]?.text ?? ''

describe('Pi tools', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = `/tmp/cherry-pi-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await fs.mkdir(tmpDir, { recursive: true })
    vi.mocked(promptForToolApproval).mockReset()
    vi.mocked(promptForToolApproval).mockResolvedValue({ behavior: 'allow' })
    vi.mocked(appCapabilityService.list).mockReset()
    vi.mocked(appCapabilityService.list).mockReturnValue([])
    vi.mocked(appCapabilityService.search).mockReset()
    vi.mocked(appCapabilityService.call).mockReset()
    vi.mocked(mcpService.listAllActiveServerTools).mockReset()
    vi.mocked(mcpService.listActiveServerToolsByIds).mockReset()
    vi.mocked(mcpService.callToolById).mockReset()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('rejects ambiguous single Edit replacements', async () => {
    const filePath = path.join(tmpDir, 'sample.txt')
    await fs.writeFile(filePath, 'same\nsame\n', 'utf8')

    const edit = getTool('Edit', tmpDir, [tmpDir])
    const result = await edit.execute('edit-1', {
      file_path: filePath,
      old_string: 'same',
      new_string: 'changed'
    })

    expect(result.details).toMatchObject({ isError: true, occurrences: 2 })
    expect(await fs.readFile(filePath, 'utf8')).toBe('same\nsame\n')
  })

  it('rejects empty Edit search strings before rewriting files', async () => {
    const filePath = path.join(tmpDir, 'sample.txt')
    await fs.writeFile(filePath, 'abc', 'utf8')

    const edit = getTool('Edit', tmpDir, [tmpDir])
    const result = await edit.execute('edit-empty', {
      file_path: filePath,
      old_string: '',
      new_string: '-',
      replace_all: true
    })

    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('old_string must be a non-empty string')
    expect(await fs.readFile(filePath, 'utf8')).toBe('abc')
  })

  it('matches root files with globstar patterns', async () => {
    await fs.writeFile(path.join(tmpDir, 'root.ts'), 'root', 'utf8')
    await fs.mkdir(path.join(tmpDir, 'nested'))
    await fs.writeFile(path.join(tmpDir, 'nested', 'child.ts'), 'child', 'utf8')

    const glob = getTool('Glob', tmpDir, [tmpDir])
    const result = await glob.execute('glob-1', {
      pattern: '**/*.ts',
      path: tmpDir
    })

    expect(resultText(result).split('\n').sort()).toEqual(['nested/child.ts', 'root.ts'])
  })

  it('skips large files when grepping', async () => {
    await fs.writeFile(path.join(tmpDir, 'small.txt'), 'needle\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'large.txt'), `${'x'.repeat(512 * 1024 + 1)}needle`, 'utf8')

    const grep = getTool('Grep', tmpDir, [tmpDir])
    const result = await grep.execute('grep-1', {
      pattern: 'needle',
      path: tmpDir,
      glob: '*.txt'
    })

    expect(resultText(result)).toContain('small.txt:1:needle')
    expect(resultText(result)).not.toContain('large.txt')
  })

  it('truncates large reads with a recovery hint', async () => {
    const filePath = path.join(tmpDir, 'large-read.txt')
    await fs.writeFile(filePath, 'x'.repeat(120 * 1024), 'utf8')
    const readFileSpy = vi.spyOn(fs, 'readFile')

    try {
      const read = getTool('Read', tmpDir, [tmpDir])
      const result = await read.execute('read-1', {
        file_path: filePath
      })

      expect(result.details).toMatchObject({ truncated: true })
      expect(readFileSpy).not.toHaveBeenCalled()
      expect(resultText(result).length).toBeLessThan(100_000)
      expect(resultText(result)).toContain('Use offset/limit or Grep')
    } finally {
      readFileSpy.mockRestore()
    }
  })

  it('streams line-window reads without loading the whole file', async () => {
    const filePath = path.join(tmpDir, 'large-window-read.txt')
    const lines = Array.from({ length: 20_000 }, (_, index) => `line-${index + 1}`)
    await fs.writeFile(filePath, lines.join('\n'), 'utf8')
    const readFileSpy = vi.spyOn(fs, 'readFile')

    try {
      const read = getTool('Read', tmpDir, [tmpDir])
      const result = await read.execute('read-window', {
        file_path: filePath,
        offset: 10_000,
        limit: 3
      })

      expect(result.details).toMatchObject({ truncated: false })
      expect(readFileSpy).not.toHaveBeenCalled()
      expect(resultText(result)).toBe('line-10000\nline-10001\nline-10002')
    } finally {
      readFileSpy.mockRestore()
    }
  })

  it('preserves utf-8 text while streaming line-window reads', async () => {
    const filePath = path.join(tmpDir, 'large-window-read-utf8.txt')
    const lines = Array.from({ length: 10_000 }, (_, index) => `第 ${index + 1} 行 🍒`)
    await fs.writeFile(filePath, lines.join('\n'), 'utf8')

    const read = getTool('Read', tmpDir, [tmpDir])
    const result = await read.execute('read-window-utf8', {
      file_path: filePath,
      offset: 9999,
      limit: 2
    })

    expect(result.details).toMatchObject({ truncated: false })
    expect(resultText(result)).toBe('第 9999 行 🍒\n第 10000 行 🍒')
  })

  it('bounds line-window reads for very long single-line files', async () => {
    const filePath = path.join(tmpDir, 'long-line.txt')
    await fs.writeFile(filePath, 'x'.repeat(160 * 1024), 'utf8')
    const readFileSpy = vi.spyOn(fs, 'readFile')

    try {
      const read = getTool('Read', tmpDir, [tmpDir])
      const result = await read.execute('read-long-line-window', {
        file_path: filePath,
        offset: 1,
        limit: 1
      })

      expect(result.details).toMatchObject({ truncated: true, bytes: 160 * 1024 })
      expect(readFileSpy).not.toHaveBeenCalled()
      expect(resultText(result).length).toBeLessThan(100_000)
      expect(resultText(result)).toContain('Read truncated')
    } finally {
      readFileSpy.mockRestore()
    }
  })

  it('prompts before reading outside accessible roots', async () => {
    const outsideFile = `/tmp/cherry-pi-outside-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    await fs.writeFile(outsideFile, 'outside ok', 'utf8')

    const read = createPiTools(tmpDir, [tmpDir], { sessionId: 'session-1' }).find((item) => item.name === 'Read')!
    const result = await read.execute('read-2', {
      file_path: outsideFile
    })

    expect(promptForToolApproval).toHaveBeenCalledWith(
      'Read',
      expect.objectContaining({
        file_path: outsideFile,
        requested_access: 'read',
        requested_paths: [outsideFile],
        requested_folders: [path.dirname(outsideFile)]
      }),
      expect.objectContaining({ toolCallId: 'session-1:read-2' })
    )
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toBe('outside ok')
    await fs.rm(outsideFile, { force: true })
  })

  it('denies file access when folder approval is rejected', async () => {
    const outsideFile = `/tmp/cherry-pi-denied-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    await fs.writeFile(outsideFile, 'outside denied', 'utf8')
    vi.mocked(promptForToolApproval).mockResolvedValueOnce({ behavior: 'deny', message: 'Nope' })

    const read = getTool('Read', tmpDir, [tmpDir])
    const result = await read.execute('read-denied', {
      file_path: outsideFile
    })

    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('Nope')
    await fs.rm(outsideFile, { force: true })
  })

  it('prompts before Bash commands reference paths outside accessible roots', async () => {
    const outsideFile = `/tmp/cherry-pi-bash-outside-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    await fs.writeFile(outsideFile, 'outside bash ok', 'utf8')

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-1', {
      command: `cat "${outsideFile}"`
    })

    expect(promptForToolApproval).toHaveBeenCalledWith(
      'Bash',
      expect.objectContaining({
        command: `cat "${outsideFile}"`,
        requested_access: 'execute',
        requested_paths: [outsideFile],
        requested_folders: [path.dirname(outsideFile)]
      }),
      expect.objectContaining({ toolCallId: 'bash-1' })
    )
    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('outside bash ok')
    await fs.rm(outsideFile, { force: true })
  })

  it('prompts before accessing sensitive folders inside an accessible root', async () => {
    const sshDir = path.join(tmpDir, '.ssh')
    const sshConfig = path.join(sshDir, 'config')
    await fs.mkdir(sshDir, { recursive: true })
    await fs.writeFile(sshConfig, 'Host example\n', 'utf8')

    const read = getTool('Read', tmpDir, [tmpDir])
    const result = await read.execute('read-sensitive', {
      file_path: sshConfig
    })

    expect(promptForToolApproval).toHaveBeenCalledWith(
      'Read',
      expect.objectContaining({
        requested_access: 'read',
        requested_paths: [sshConfig],
        requested_folders: [sshDir]
      }),
      expect.objectContaining({ toolCallId: 'read-sensitive' })
    )
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('Host example')
  })

  it('prompts before Bash commands read sensitive relative dotfiles', async () => {
    const envFile = path.join(tmpDir, '.env')
    await fs.writeFile(envFile, 'SECRET_TOKEN=abc123\n', 'utf8')

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-sensitive-dotfile', {
      command: 'cat .env'
    })

    expect(promptForToolApproval).toHaveBeenCalledWith(
      'Bash',
      expect.objectContaining({
        command: 'cat .env',
        requested_access: 'execute',
        requested_paths: [envFile],
        requested_folders: [tmpDir]
      }),
      expect.objectContaining({ toolCallId: 'bash-sensitive-dotfile' })
    )
    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(resultText(result)).toContain('SECRET_TOKEN=abc123')
  })

  it('prompts before Bash commands read sensitive relative dot-directories', async () => {
    const sshDir = path.join(tmpDir, '.ssh')
    const sshConfig = path.join(sshDir, 'config')
    await fs.mkdir(sshDir, { recursive: true })
    await fs.writeFile(sshConfig, 'Host sensitive\n', 'utf8')

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-sensitive-dotdir', {
      command: 'cat ./.ssh/config'
    })

    expect(promptForToolApproval).toHaveBeenCalledWith(
      'Bash',
      expect.objectContaining({
        command: 'cat ./.ssh/config',
        requested_access: 'execute',
        requested_paths: [sshConfig],
        requested_folders: [sshDir]
      }),
      expect.objectContaining({ toolCallId: 'bash-sensitive-dotdir' })
    )
    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(resultText(result)).toContain('Host sensitive')
  })

  it('allows Bash commands that modify system SSL trust settings', async () => {
    const bash = getTool('Bash', tmpDir, [tmpDir])
    const fakeSecurity = path.join(tmpDir, 'security')
    await fs.writeFile(fakeSecurity, '#!/bin/sh\necho "security $*"\n', 'utf8')
    await fs.chmod(fakeSecurity, 0o755)

    const result = await bash.execute('bash-system-ssl', {
      command: `PATH="${tmpDir}:$PATH" security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain cert.pem`
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('/Library/Keychains/System.keychain')
  })

  it('allows global SSL verification configuration commands', async () => {
    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-disable-ssl', {
      command: 'git config --global http.sslVerify false'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
  })

  it('allows global npm registration commands', async () => {
    const fakeNpm = path.join(tmpDir, 'npm')
    await fs.writeFile(fakeNpm, '#!/bin/sh\necho "npm $*"\n', 'utf8')
    await fs.chmod(fakeNpm, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-global-register', {
      command: `PATH="${tmpDir}:$PATH" npm link && PATH="${tmpDir}:$PATH" npm publish --dry-run`,
      description: 'Register tool globally after path restriction'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('npm link')
  })

  it('allows npm global CLI installs through the agent-scoped tool prefix', async () => {
    const fakeNpm = path.join(tmpDir, 'npm')
    await fs.writeFile(fakeNpm, '#!/bin/sh\necho "prefix=$NPM_CONFIG_PREFIX"\necho "path=$PATH"\n', 'utf8')
    await fs.chmod(fakeNpm, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-global-cli-install', {
      command: `PATH="${tmpDir}:$PATH" npm install -g feishu-cli`,
      description: 'Install feishu-cli globally via npm'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('cherry-studio-pi-agent-tools')
  })

  it('still allows local package manager installs in the workspace', async () => {
    const fakeNpm = path.join(tmpDir, 'npm')
    await fs.writeFile(fakeNpm, '#!/bin/sh\necho "local install ok"\n', 'utf8')
    await fs.chmod(fakeNpm, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-local-install', {
      command: `PATH="${tmpDir}:$PATH" npm install`,
      description: 'Install project dependencies'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('local install ok')
  })

  it('allows local package installs even when described as a restriction workaround', async () => {
    const fakeNpm = path.join(tmpDir, 'npm')
    await fs.writeFile(fakeNpm, '#!/bin/sh\necho "workaround install ok"\n', 'utf8')
    await fs.chmod(fakeNpm, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-local-install-workaround', {
      command: `PATH="${tmpDir}:$PATH" npm install some-cli`,
      description: '系统限制了全局安装，让我在本地工作区安装'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('workaround install ok')
  })

  it('returns documentation fetch SSL failures as normal command failures', async () => {
    const fakeCurl = path.join(tmpDir, 'curl')
    await fs.writeFile(
      fakeCurl,
      '#!/bin/sh\necho "curl: (35) LibreSSL SSL_connect: certificate verify failed" >&2\nexit 35\n',
      'utf8'
    )
    await fs.chmod(fakeCurl, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-doc-fetch-ssl', {
      command: `PATH="${tmpDir}:$PATH" curl -fsSL https://example.com/feishu-cli/install`,
      description: 'Fetch Feishu CLI installation guide'
    })

    expect(result.details).toMatchObject({ exitCode: 35, isError: true })
    expect(resultText(result)).toContain('SSL_connect')
  })

  it('allows manual Node binary download commands to run', async () => {
    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-manual-binary-download', {
      command: 'node -e "console.log(\\"download command allowed\\")"',
      description: '安装脚本使用 curl 下载二进制时遇到系统 SSL 问题。让我用 Node.js 手动下载二进制文件来解决'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('download command allowed')
  })

  it('returns npm binary download SSL failures without policy-blocking retries', async () => {
    const fakeNpm = path.join(tmpDir, 'npm')
    await fs.writeFile(
      fakeNpm,
      `#!/bin/sh
echo "postinstall download binary from https://example.com/releases/tool.tar.gz failed: unable to verify SSL certificate" >&2
exit 1
`,
      'utf8'
    )
    await fs.chmod(fakeNpm, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-install-binary-ssl', {
      command: `PATH="${tmpDir}:$PATH" npm install native-package`,
      description: 'Install package dependencies'
    })

    expect(result.details).toMatchObject({ exitCode: 1, isError: true })
    expect(result.details).not.toMatchObject({ blockedRetry: true })
    expect(resultText(result)).toContain('unable to verify SSL certificate')
  })

  it('treats diagnostic Bash misses as recoverable output', async () => {
    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-check', {
      command: 'test -f .claude/skills/missing/SKILL.md',
      description: 'Check target skill location'
    })

    expect(result.details).toMatchObject({ exitCode: 1, recoverable: true })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('Treat this as a miss')
  })

  it('runs simple Bash commands inside the workspace sandbox', async () => {
    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-2', {
      command: 'echo hi'
    })

    expect(result.details).toMatchObject({ exitCode: 0 })
    expect(resultText(result).trim()).toBe('hi')
  })

  it('uses POSIX sh without the unsupported login flag on Linux', () => {
    expect(buildPiBashShellInvocation('linux', 'echo hi')).toEqual({
      file: '/bin/sh',
      args: ['-c', 'echo hi']
    })
  })

  it('includes HTTP, app capability, and browser tools by default', () => {
    const tools = createPiTools(tmpDir, [tmpDir]).map((tool) => tool.name)

    expect(tools).toEqual(
      expect.arrayContaining([
        'HTTPRequest',
        'AppSearchCapabilities',
        'AppCallCapability',
        'BrowserOpen',
        'BrowserExecute',
        'BrowserReset'
      ])
    )
  })

  it('safely truncates HTTPRequest output when max_chars is invalid', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/large',
      text: vi.fn(async () => 'x'.repeat(10_000))
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-invalid-max', {
      url: 'https://example.test/large',
      max_chars: 0
    })

    expect(result.details).toMatchObject({ truncated: true })
    expect(resultText(result)).toContain('truncated 9999 chars')
    expect(resultText(result)).not.toContain('x'.repeat(1000))
  })

  it('caps HTTPRequest output to the tool response budget', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/large',
      text: vi.fn(async () => 'x'.repeat(80_000))
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-large-max', {
      url: 'https://example.test/large',
      max_chars: 1_000_000
    })

    expect(result.details).toMatchObject({ truncated: true })
    expect(resultText(result).length).toBeLessThan(25_000)
  })

  it('stops streaming HTTPRequest responses after the response budget', async () => {
    const cancel = vi.fn()
    const text = vi.fn(async () => 'should-not-read-full-response')
    vi.mocked(net.fetch).mockResolvedValueOnce({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from('hello'))
          controller.enqueue(Buffer.from(' world'))
        },
        cancel
      }),
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/stream',
      text
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-stream-budget', {
      url: 'https://example.test/stream',
      max_chars: 5
    })

    expect(text).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
    expect(result.details).toMatchObject({ truncated: true })
    expect(resultText(result)).toContain('hello')
    expect(resultText(result)).toContain('truncated response after 5 chars')
  })

  it('normalizes HTTPRequest URLs before fetching', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/ok',
      text: vi.fn(async () => 'ok')
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-normalized-url', {
      url: '  https://example.test/ok  '
    })

    expect(net.fetch).toHaveBeenCalledWith('https://example.test/ok', expect.objectContaining({ method: 'GET' }))
    expect(result.details).toMatchObject({ ok: true })
    expect(resultText(result)).toBe('ok')
  })

  it('rejects non-http HTTPRequest URLs before fetching', async () => {
    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-file-url', {
      url: 'file:///etc/passwd'
    })

    expect(net.fetch).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('only supports http:// and https://')
  })

  it.each(['http://127.0.0.1:3000/admin', 'http://localhost:3000/admin', 'http://192.168.1.10/admin'])(
    'rejects private HTTPRequest URLs before fetching: %s',
    async (url) => {
      const request = getTool('HTTPRequest', tmpDir, [tmpDir])
      const result = await request.execute('http-private-url', { url })

      expect(net.fetch).not.toHaveBeenCalled()
      expect(result.details).toMatchObject({ isError: true })
      expect(resultText(result)).toContain('local or private addresses are not allowed')
    }
  )

  it('rejects credential-bearing HTTPRequest URLs before fetching', async () => {
    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-credentials-url', {
      url: 'https://user:secret@example.test/private'
    })

    expect(net.fetch).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('credentials are not allowed')
  })

  it('normalizes HTTPRequest methods before deciding request body', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/head',
      text: vi.fn(async () => 'ok')
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    await request.execute('http-normalized-method', {
      url: 'https://example.test/head',
      method: ' head ',
      body: 'should-not-send'
    })

    expect(net.fetch).toHaveBeenCalled()
    const init = vi.mocked(net.fetch).mock.calls[0][1] as RequestInit
    expect(init).toMatchObject({ method: 'HEAD' })
    expect(init.body).toBeUndefined()
  })

  it('rejects invalid HTTPRequest methods before fetching', async () => {
    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-invalid-method', {
      url: 'https://example.test/ok',
      method: 'GET /admin'
    })

    expect(net.fetch).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('method is invalid')
  })

  it('normalizes HTTPRequest headers before fetching', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/headers',
      text: vi.fn(async () => 'ok')
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    await request.execute('http-normalized-headers', {
      url: 'https://example.test/headers',
      headers: {
        ' Authorization ': 'Bearer token',
        Retry: 3,
        Skip: null
      }
    })

    expect(net.fetch).toHaveBeenCalled()
    const init = vi.mocked(net.fetch).mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({
      Authorization: 'Bearer token',
      Retry: '3'
    })
  })

  it('rejects unsafe HTTPRequest headers before fetching', async () => {
    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-unsafe-headers', {
      url: 'https://example.test/ok',
      headers: {
        Authorization: 'Bearer token\nX-Injected: yes'
      }
    })

    expect(net.fetch).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('line breaks')
  })

  it('normalizes HTTPRequest body before fetching', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      headers: { get: vi.fn(() => 'text/plain') },
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://example.test/post',
      text: vi.fn(async () => 'ok')
    } as any)

    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    await request.execute('http-normalized-body', {
      url: 'https://example.test/post',
      method: 'post',
      body: 42
    })

    expect(net.fetch).toHaveBeenCalled()
    const init = vi.mocked(net.fetch).mock.calls[0][1] as RequestInit
    expect(init).toMatchObject({ method: 'POST', body: '42' })
  })

  it('rejects object HTTPRequest bodies before fetching', async () => {
    const request = getTool('HTTPRequest', tmpDir, [tmpDir])
    const result = await request.execute('http-object-body', {
      url: 'https://example.test/post',
      method: 'POST',
      body: { ok: true }
    })

    expect(net.fetch).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('body must be a string-compatible scalar value')
  })

  it('marks AppCallCapability as a direct app bridge that does not require tool permission', () => {
    expect(builtinTools.find((tool) => tool.id === 'AppCallCapability')).toMatchObject({
      requirePermissions: false
    })
  })

  it('searches app capabilities through the direct app bridge', async () => {
    vi.mocked(appCapabilityService.search).mockReturnValueOnce([
      {
        id: 'storage.backup.create',
        domain: 'storage',
        kind: 'command',
        title: 'Create local backup',
        description: 'Create a backup',
        risk: 'write'
      } as any
    ])

    const search = getTool('AppSearchCapabilities', tmpDir, [tmpDir])
    const result = await search.execute('app-search', {
      query: 'local backup',
      limit: 3
    })

    expect(appCapabilityService.search).toHaveBeenCalledWith({
      query: 'local backup',
      domain: undefined,
      risk: undefined,
      limit: 3,
      includeSchemas: false
    })
    expect(resultText(result)).toContain('storage.backup.create')
  })

  it('returns a clear error when AppSearchCapabilities receives malformed params', async () => {
    const search = getTool('AppSearchCapabilities', tmpDir, [tmpDir])
    const result = await search.execute('app-search-malformed', null as any)

    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('AppSearchCapabilities parameters must be an object')
    expect(appCapabilityService.search).not.toHaveBeenCalled()
  })

  it('calls app capabilities directly without interactive tool approval', async () => {
    vi.mocked(appCapabilityService.call).mockResolvedValueOnce({
      ok: true,
      summary: 'Backup created',
      data: { path: '/tmp/backup' }
    })

    const call = createPiTools(tmpDir, [tmpDir], { sessionId: 'session-1' }).find(
      (tool) => tool.name === 'AppCallCapability'
    )!
    const result = await call.execute('app-call', {
      id: 'storage.backup.create',
      input: { reason: 'test' }
    })

    expect(promptForToolApproval).not.toHaveBeenCalled()
    expect(appCapabilityService.list).not.toHaveBeenCalled()
    expect(appCapabilityService.call).toHaveBeenCalledWith(
      'storage.backup.create',
      { reason: 'test' },
      expect.objectContaining({
        source: 'agent',
        sessionId: 'session-1',
        toolCallId: 'session-1:app-call',
        dryRun: false
      })
    )
    expect(resultText(result)).toContain('Backup created')
  })

  it('returns a clear error when AppCallCapability receives malformed params', async () => {
    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-malformed', [] as any)

    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('AppCallCapability parameters must be an object')
    expect(appCapabilityService.call).not.toHaveBeenCalled()
  })

  it('rejects empty AppCallCapability ids before calling the app service', async () => {
    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-empty-id', { id: '   ' })

    expect(result.details).toMatchObject({ isError: true })
    expect(resultText(result)).toContain('AppCallCapability requires a non-empty capability id')
    expect(appCapabilityService.call).not.toHaveBeenCalled()
  })

  it('redacts secrets from thrown app capability errors', async () => {
    vi.mocked(appCapabilityService.call).mockRejectedValueOnce(
      new Error(
        'Failed with apiKey=sk-secret-token and Authorization: Bearer bearer-secret at https://user:pass@example.test'
      )
    )

    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-secret-error', {
      id: 'settings.read',
      input: {}
    })
    const serialized = JSON.stringify(result)

    expect(result.details).toMatchObject({ isError: true })
    expect(serialized).not.toContain('sk-secret-token')
    expect(serialized).not.toContain('bearer-secret')
    expect(serialized).not.toContain('user:pass')
    expect(resultText(result)).toContain('apiKey=[redacted]')
    expect(resultText(result)).toContain('Authorization: Bearer [redacted]')
    expect(resultText(result)).toContain('https://[redacted]@example.test')
  })

  it('redacts secrets from returned app capability error results', async () => {
    vi.mocked(appCapabilityService.call).mockResolvedValueOnce({
      ok: false,
      isError: true,
      summary: 'Failed with apiKey=sk-secret-token',
      error: 'Authorization: Bearer bearer-secret at https://user:pass@example.test',
      warnings: ['password=plain-secret']
    })

    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-returned-secret-error', {
      id: 'settings.read',
      input: {}
    })
    const serialized = JSON.stringify(result)

    expect(result.details).toMatchObject({ isError: true })
    expect(serialized).not.toContain('sk-secret-token')
    expect(serialized).not.toContain('bearer-secret')
    expect(serialized).not.toContain('user:pass')
    expect(serialized).not.toContain('plain-secret')
    expect(resultText(result)).toContain('apiKey=[redacted]')
    expect(resultText(result)).toContain('Authorization: Bearer [redacted]')
    expect(resultText(result)).toContain('https://[redacted]@example.test')
    expect(resultText(result)).toContain('password=[redacted]')
  })

  it('keeps non-secret words containing pass visible in app capability errors', async () => {
    vi.mocked(appCapabilityService.call).mockResolvedValueOnce({
      ok: false,
      isError: true,
      summary: 'Failed near compass=north and passage=visible',
      error: 'db_pass=plain-secret'
    })

    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-passage-error', {
      id: 'settings.read',
      input: {}
    })
    const serialized = JSON.stringify(result)

    expect(result.details).toMatchObject({ isError: true })
    expect(serialized).not.toContain('plain-secret')
    expect(resultText(result)).toContain('compass=north')
    expect(resultText(result)).toContain('passage=visible')
    expect(resultText(result)).toContain('db_pass=[redacted]')
  })

  it('times out stalled AppCallCapability calls and aborts the app capability signal', async () => {
    vi.useFakeTimers()
    let capturedSignal: AbortSignal | undefined

    try {
      vi.mocked(appCapabilityService.call).mockImplementationOnce(async (_id, _input, context) => {
        capturedSignal = context?.signal
        return new Promise(() => {})
      })

      const call = getTool('AppCallCapability', tmpDir, [tmpDir])
      const pendingResult = call.execute('app-call-timeout', {
        id: 'settings.read',
        input: {},
        timeoutMs: 100
      })

      await vi.advanceTimersByTimeAsync(100)
      const result = await pendingResult

      expect(capturedSignal?.aborted).toBe(true)
      expect(result.details).toMatchObject({ isError: true })
      expect(resultText(result)).toContain('AppCallCapability settings.read timed out after 100ms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies default timeouts to stalled AppCallCapability calls', async () => {
    vi.useFakeTimers()
    let capturedSignal: AbortSignal | undefined

    try {
      vi.mocked(appCapabilityService.call).mockImplementationOnce(async (_id, _input, context) => {
        capturedSignal = context?.signal
        return new Promise(() => {})
      })

      const call = getTool('AppCallCapability', tmpDir, [tmpDir])
      const pendingResult = call.execute('app-call-default-timeout', {
        id: 'settings.read',
        input: {}
      })

      await vi.advanceTimersByTimeAsync(5_000)
      const result = await pendingResult

      expect(capturedSignal?.aborted).toBe(true)
      expect(result.details).toMatchObject({ isError: true })
      expect(resultText(result)).toContain('AppCallCapability settings.read timed out after 5000ms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('compacts large AppCallCapability results before returning them to the agent', async () => {
    vi.mocked(appCapabilityService.call).mockResolvedValueOnce({
      ok: true,
      summary: 'Large settings read',
      data: { text: 'x'.repeat(80_000) }
    })

    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-large', {
      id: 'settings.read',
      input: {}
    })

    expect(result.details).toMatchObject({ truncated: true })
    expect(result.details?.structuredContent).toMatchObject({
      summary: 'Large settings read',
      resultTruncated: true
    })
    expect(JSON.stringify(result.details?.structuredContent).length).toBeLessThan(20_000)
    expect(resultText(result).length).toBeLessThan(20_000)
  })

  it('does not read AppCallCapability data properties after the preview budget is exceeded', async () => {
    const data: Record<string, unknown> = { huge: 'x'.repeat(80_000) }
    Object.defineProperty(data, 'danger', {
      enumerable: true,
      get: () => {
        throw new Error('danger getter should not be read')
      }
    })

    vi.mocked(appCapabilityService.call).mockResolvedValueOnce({
      ok: true,
      summary: 'Large unsafe data read',
      data
    })

    const call = getTool('AppCallCapability', tmpDir, [tmpDir])
    const result = await call.execute('app-call-large-unsafe', {
      id: 'settings.read',
      input: {}
    })

    expect(result.details).toMatchObject({ truncated: true })
    expect(result.details?.isError).toBeUndefined()
    expect(result.details?.structuredContent).toMatchObject({
      summary: 'Large unsafe data read',
      resultTruncated: true
    })
    expect(resultText(result)).not.toContain('danger getter should not be read')
  })

  it('limits Grep glob candidates before scanning matched files', async () => {
    for (let index = 0; index < 4100; index += 1) {
      await fs.writeFile(path.join(tmpDir, `file-${String(index).padStart(4, '0')}.txt`), 'miss\n', 'utf8')
    }
    await fs.writeFile(path.join(tmpDir, 'file-9999.txt'), 'needle\n', 'utf8')

    const grep = getTool('Grep', tmpDir, [tmpDir])
    const result = await grep.execute('grep-many', {
      pattern: 'needle',
      path: tmpDir,
      glob: '*.txt'
    })

    expect(result.details).toMatchObject({ count: 0 })
    expect(resultText(result)).toBe('No matches found')
  })

  it('truncates noisy Bash failures', async () => {
    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-3', {
      command: 'node -e "console.error(\'e\'.repeat(20000)); process.exit(1)"'
    })

    expect(result.details).toMatchObject({ exitCode: 1, isError: true, truncated: true })
    expect(resultText(result).length).toBeLessThan(9_000)
    expect(resultText(result)).toContain('truncated')
  })

  it('retries npm mirror SSL failures with the official registry', async () => {
    const fakeNpm = path.join(tmpDir, 'npm')
    await fs.writeFile(
      fakeNpm,
      `#!/bin/sh
if [ "$NPM_CONFIG_REGISTRY" = "https://registry.npmjs.org" ]; then
  echo "installed from official registry"
  exit 0
fi
echo "https://registry.npmmirror.com binary download failed: unable to verify SSL certificate" >&2
exit 1
`,
      'utf8'
    )
    await fs.chmod(fakeNpm, 0o755)

    const bash = getTool('Bash', tmpDir, [tmpDir])
    const result = await bash.execute('bash-npm-retry', {
      command: `PATH="${tmpDir}:$PATH" npm install native-package`,
      description: 'Install package dependencies'
    })

    expect(result.details).toMatchObject({ exitCode: 0, retriedRegistry: 'https://registry.npmjs.org' })
    expect(result.details).not.toMatchObject({ isError: true })
    expect(resultText(result)).toContain('Retried with https://registry.npmjs.org')
    expect(resultText(result)).toContain('installed from official registry')
  })

  it('creates executable Pi tools for selected MCP servers', async () => {
    vi.mocked(mcpService.listActiveServerToolsByIds).mockResolvedValueOnce([
      {
        id: 'mcp__github__searchRepos',
        serverId: 'github-id',
        serverName: 'github',
        name: 'search_repos',
        description: 'Search repositories',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query']
        },
        type: 'mcp'
      } as any,
      {
        id: 'mcp__other__ignored',
        serverId: 'other-id',
        serverName: 'other',
        name: 'ignored',
        inputSchema: { type: 'object', properties: {}, required: [] },
        type: 'mcp'
      } as any
    ])
    vi.mocked(mcpService.callToolById).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"ok":true}' }]
    } as any)

    const tools = await createPiMcpTools(['github-id'])
    expect(mcpService.listActiveServerToolsByIds).toHaveBeenCalledWith(['github-id'])
    expect(mcpService.listAllActiveServerTools).not.toHaveBeenCalled()
    expect(tools.map((tool) => tool.name)).toEqual(['mcp__github__searchRepos'])

    const result = await tools[0].execute('call-1', { query: 'pi' })
    expect(mcpService.callToolById).toHaveBeenCalledWith('github-id__search_repos', { query: 'pi' }, 'call-1')
    expect(resultText(result)).toBe('{"ok":true}')
  })
})
