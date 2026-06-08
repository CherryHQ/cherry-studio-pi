import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execAsync: vi.fn(),
  execFile: vi.fn(),
  execFileAsync: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@main/core/platform', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@main/utils', () => ({
  removeEnvProxy: vi.fn()
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn().mockResolvedValue(false)
}))

vi.mock('@main/utils/process', () => ({
  getBinaryName: vi.fn().mockResolvedValue('bun')
}))

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
  exec: mocks.exec,
  execFile: mocks.execFile
}))

vi.mock('util', () => ({
  promisify: vi.fn((fn) => (fn === mocks.execFile ? mocks.execFileAsync : mocks.execAsync))
}))

vi.mock('semver', () => ({
  default: { coerce: vi.fn(), gte: vi.fn().mockReturnValue(false) }
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn()
}))

async function loadModules() {
  const { BaseService } = await import('@main/core/lifecycle')
  const { CodeCliService } = await import('../CodeCliService')
  const codeCliService = new CodeCliService()
  return { BaseService, CodeCliService, codeCliService }
}

describe('CodeCliService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.execAsync.mockResolvedValue({ stdout: '' })
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should extend BaseService', async () => {
    const { BaseService, codeCliService } = await loadModules()
    expect(codeCliService).toBeInstanceOf(BaseService)
  })

  it('should have onInit that preloads terminals', async () => {
    const { codeCliService } = await loadModules()
    await expect(codeCliService._doInit()).resolves.toBeUndefined()
    expect(codeCliService.isReady).toBe(true)
  })

  it('should clean up timers on stop', async () => {
    const { codeCliService } = await loadModules()
    await codeCliService._doInit()
    await expect(codeCliService._doStop()).resolves.toBeUndefined()
    expect(codeCliService.isStopped).toBe(true)
  })

  it('clears terminal check timeout timers after fast terminal checks', async () => {
    vi.useFakeTimers()
    const { codeCliService } = await loadModules()
    const service = codeCliService as unknown as {
      checkTerminalAvailability: ReturnType<typeof vi.fn>
      getAvailableTerminals: () => Promise<unknown[]>
    }
    service.checkTerminalAvailability = vi.fn(async (terminal) => terminal)

    const terminals = await service.getAvailableTerminals()

    expect(terminals.length).toBeGreaterThan(0)
    expect(service.checkTerminalAvailability).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caches npm registry location detection during the service lifetime', async () => {
    const { codeCliService } = await loadModules()
    const { isUserInChina } = await import('@main/utils/ipService')
    const service = codeCliService as unknown as {
      getNpmRegistryUrl: () => Promise<string>
    }

    await expect(service.getNpmRegistryUrl()).resolves.toBe('https://registry.npmjs.org')
    await expect(service.getNpmRegistryUrl()).resolves.toBe('https://registry.npmjs.org')

    expect(isUserInChina).toHaveBeenCalledTimes(1)
  })

  it('checks custom terminal paths with execFile arguments instead of a shell command string', async () => {
    const { codeCliService } = await loadModules()
    const fs = await import('node:fs')
    const { terminalApps } = await import('@shared/config/constant')
    const service = codeCliService as unknown as {
      checkCustomTerminalPath: (terminal: { id: string; name: string }) => Promise<unknown>
    }
    const customPath = 'C:\\Tools\\terminal" & calc.exe'

    vi.mocked(fs.default.existsSync).mockReturnValue(true)
    codeCliService.setCustomTerminalPath(terminalApps.alacritty, customPath)

    await expect(service.checkCustomTerminalPath({ id: terminalApps.alacritty, name: 'Alacritty' })).resolves.toEqual(
      expect.objectContaining({ customPath })
    )

    expect(mocks.execFileAsync).toHaveBeenCalledWith(customPath, ['--version'], { timeout: 3000 })
    expect(mocks.execAsync).not.toHaveBeenCalledWith(expect.stringContaining(customPath), expect.anything())
  })

  it('skips pre-launch version checks for installed tools when auto update is disabled', async () => {
    const { codeCliService } = await loadModules()
    const { codeCLI } = await import('@shared/config/constant')
    const fs = await import('node:fs')
    const { spawn } = await import('child_process')
    const service = codeCliService as unknown as {
      run: (
        event: Electron.IpcMainInvokeEvent,
        cliTool: string,
        model: string,
        directory: string,
        env: Record<string, string>,
        options?: { autoUpdateToLatest?: boolean; terminal?: string }
      ) => Promise<unknown>
      getVersionInfo: ReturnType<typeof vi.fn>
      getTerminalConfig: ReturnType<typeof vi.fn>
    }

    vi.mocked(fs.default.existsSync).mockReturnValue(true)
    service.getVersionInfo = vi.fn()
    service.getTerminalConfig = vi.fn(async () => ({
      id: 'Terminal',
      name: 'Terminal',
      command: (_directory: string, fullCommand: string) => ({
        command: 'terminal',
        args: [fullCommand]
      })
    }))

    await expect(
      service.run({} as Electron.IpcMainInvokeEvent, codeCLI.openaiCodex, 'gpt-5', '/workspace', {}, {})
    ).resolves.toMatchObject({
      success: true
    })

    expect(service.getVersionInfo).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledWith(
      'terminal',
      expect.any(Array),
      expect.objectContaining({
        cwd: '/workspace'
      })
    )
  })

  it('uses only the local qwen-code version before launch when auto update is disabled', async () => {
    const { codeCliService } = await loadModules()
    const { codeCLI } = await import('@shared/config/constant')
    const fs = await import('node:fs')
    const service = codeCliService as unknown as {
      run: (
        event: Electron.IpcMainInvokeEvent,
        cliTool: string,
        model: string,
        directory: string,
        env: Record<string, string>,
        options?: { autoUpdateToLatest?: boolean; terminal?: string }
      ) => Promise<unknown>
      getInstalledVersion: ReturnType<typeof vi.fn>
      getVersionInfo: ReturnType<typeof vi.fn>
      getTerminalConfig: ReturnType<typeof vi.fn>
    }

    vi.mocked(fs.default.existsSync).mockReturnValue(true)
    service.getInstalledVersion = vi.fn().mockResolvedValue('0.12.3')
    service.getVersionInfo = vi.fn()
    service.getTerminalConfig = vi.fn(async () => ({
      id: 'Terminal',
      name: 'Terminal',
      command: (_directory: string, fullCommand: string) => ({
        command: 'terminal',
        args: [fullCommand]
      })
    }))

    await expect(
      service.run({} as Electron.IpcMainInvokeEvent, codeCLI.qwenCode, 'qwen-plus', '/workspace', {}, {})
    ).resolves.toMatchObject({
      success: true
    })

    expect(service.getInstalledVersion).toHaveBeenCalledWith(codeCLI.qwenCode, { skipInstalledCheck: true })
    expect(service.getVersionInfo).not.toHaveBeenCalled()
  })

  it('should prevent double instantiation', async () => {
    const { CodeCliService } = await loadModules()
    // loadModules() already created one instance,
    // so creating another should throw
    expect(() => new CodeCliService()).toThrow(/already been instantiated/)
  })
})
