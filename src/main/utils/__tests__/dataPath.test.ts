import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fs: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn()
  },
  getPath: vi.fn(),
  getAppPath: vi.fn(),
  isPackaged: false
}))

vi.mock('node:fs', () => ({
  ...mocks.fs,
  default: mocks.fs
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: mocks.getAppPath,
    getPath: mocks.getPath,
    get isPackaged() {
      return mocks.isPackaged
    }
  }
}))

describe('getDataPath', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.CHERRY_STUDIO_STORAGE_V2_ROOT
    mocks.getPath.mockImplementation((key: string) => {
      if (key === 'appData') return '/mock/appData'
      if (key === 'home') return '/mock/home'
      if (key === 'userData') return '/mock/appData/Cherry Studio Pi'
      return '/mock/unknown'
    })
    mocks.getAppPath.mockReturnValue('/mock/app')
    mocks.isPackaged = false
    mocks.fs.existsSync.mockReturnValue(false)
    mocks.fs.mkdirSync.mockReturnValue(undefined as never)
    mocks.fs.readFileSync.mockReturnValue('{}')
    mocks.fs.readdirSync.mockReturnValue([])
    mocks.fs.statSync.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 1
    } as never)
  })

  it('uses unpacked resources when packaged app resources are outside app.asar', async () => {
    mocks.isPackaged = true
    mocks.getAppPath.mockReturnValue('/Applications/Cherry Studio Pi.app/Contents/Resources/app.asar')
    mocks.fs.existsSync.mockImplementation((candidate) => String(candidate).endsWith('/app.asar.unpacked/resources'))

    const { getResourcePath } = await import('../index')

    expect(getResourcePath()).toBe('/Applications/Cherry Studio Pi.app/Contents/Resources/app.asar.unpacked/resources')
  })

  it('uses the active configured data root for runtime paths', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    const configuredRoot = '/mock/stable/Data'
    mocks.fs.existsSync.mockImplementation((candidate) => [configPath, configuredRoot].includes(String(candidate)))
    mocks.fs.readFileSync.mockImplementation((candidate) => {
      if (String(candidate) === configPath) {
        return JSON.stringify({
          dataRoots: [
            {
              app: 'cherry-studio-pi',
              path: configuredRoot,
              active: true
            }
          ]
        })
      }

      return '{}'
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath('Skills')).toBe('/mock/stable/Data/Skills')
    expect(mocks.fs.mkdirSync).toHaveBeenCalledWith('/mock/stable/Data/Skills', { recursive: true })
  })

  it('accepts active configured roots written by legacy Perry Studio builds', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    const configuredRoot = '/mock/perry-custom/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, configuredRoot, `${configuredRoot}/main.db`].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockImplementation((candidate) => {
      if (String(candidate) === configPath) {
        return JSON.stringify({
          dataRoots: [
            {
              app: 'perry-studio',
              path: configuredRoot,
              active: true
            }
          ]
        })
      }

      return '{}'
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(configuredRoot)
  })

  it('ignores active configured roots owned by the main Cherry Studio app', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    const cherryStudioRoot = '/mock/cherry-studio/Data'
    const currentRoot = '/mock/appData/Cherry Studio Pi/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, cherryStudioRoot, `${cherryStudioRoot}/main.db`].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockImplementation((candidate) => {
      if (String(candidate) === configPath) {
        return JSON.stringify({
          dataRoots: [
            {
              app: 'cherry-studio',
              path: cherryStudioRoot,
              active: true
            }
          ]
        })
      }

      return '{}'
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(currentRoot)
  })

  it('ignores unscoped configured roots because their owner app is ambiguous', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    const unscopedRoot = '/mock/unscoped/Data'
    const currentRoot = '/mock/appData/Cherry Studio Pi/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, unscopedRoot, `${unscopedRoot}/main.db`].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockImplementation((candidate) => {
      if (String(candidate) === configPath) {
        return JSON.stringify({
          dataRoots: [
            {
              path: unscopedRoot,
              active: true
            }
          ]
        })
      }

      return '{}'
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(currentRoot)
  })

  it('does not let an empty configured data root shadow the current root with real data', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    const configuredRoot = '/mock/stable/Data'
    const currentRoot = '/mock/appData/Cherry Studio Pi/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, configuredRoot, `${currentRoot}/app.db`].includes(String(candidate))
    )
    mocks.fs.readFileSync.mockImplementation((candidate) => {
      if (String(candidate) === configPath) {
        return JSON.stringify({
          dataRoots: [
            {
              app: 'cherry-studio-pi',
              path: configuredRoot,
              active: true
            }
          ]
        })
      }

      return '{}'
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(currentRoot)
  })

  it('does not count empty data directories as real runtime data', async () => {
    const configPath = '/mock/home/.cherrystudio/config/config.json'
    const configuredRoot = '/mock/stale/Data'
    const currentRoot = '/mock/appData/Cherry Studio Pi/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [configPath, configuredRoot, `${configuredRoot}/Files`, `${currentRoot}/app.db`].includes(String(candidate))
    )
    mocks.fs.statSync.mockImplementation(
      (candidate) =>
        ({
          isDirectory: () => String(candidate).endsWith('/Files'),
          isFile: () => !String(candidate).endsWith('/Files'),
          size: 1
        }) as never
    )
    mocks.fs.readdirSync.mockReturnValue([])
    mocks.fs.readFileSync.mockImplementation((candidate) => {
      if (String(candidate) === configPath) {
        return JSON.stringify({
          dataRoots: [
            {
              app: 'cherry-studio-pi',
              path: configuredRoot,
              active: true
            }
          ]
        })
      }

      return '{}'
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(currentRoot)
  })

  it('uses an existing legacy root when the current renamed root is empty', async () => {
    const legacyRoot = '/mock/appData/Perry Studio/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [legacyRoot, `${legacyRoot}/agents.db`].includes(String(candidate))
    )

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(legacyRoot)
  })

  it('detects a legacy root that only contains default Notes or Workspace assets', async () => {
    const legacyRoot = '/mock/appData/Perry Studio/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [legacyRoot, `${legacyRoot}/Notes`, `${legacyRoot}/Workspace`].includes(String(candidate))
    )
    mocks.fs.statSync.mockImplementation(
      (candidate) =>
        ({
          isDirectory: () => String(candidate).endsWith('/Notes') || String(candidate).endsWith('/Workspace'),
          isFile: () => false,
          size: 0
        }) as never
    )
    mocks.fs.readdirSync.mockImplementation((candidate) => {
      if (String(candidate).endsWith('/Notes')) return ['note.md'] as never
      if (String(candidate).endsWith('/Workspace')) return ['README.md'] as never
      return [] as never
    })

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(legacyRoot)
  })

  it('does not discover the main Cherry Studio default data root as a Pi legacy root', async () => {
    const cherryStudioRoot = '/mock/appData/Cherry Studio/Data'
    const currentRoot = '/mock/appData/Cherry Studio Pi/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [cherryStudioRoot, `${cherryStudioRoot}/agents.db`].includes(String(candidate))
    )

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(currentRoot)
  })

  it('keeps getDefaultDataPath pinned to the Electron userData root', async () => {
    const legacyRoot = '/mock/appData/Perry Studio/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [legacyRoot, `${legacyRoot}/agents.db`].includes(String(candidate))
    )

    const { getDefaultDataPath } = await import('../index')

    expect(getDefaultDataPath()).toBe('/mock/appData/Cherry Studio Pi/Data')
  })
})

describe('debounce', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('runs once at the end of the debounce window by default', async () => {
    vi.useFakeTimers()
    try {
      const { debounce } = await import('../index')
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced('a')
      debounced('b')
      await vi.advanceTimersByTimeAsync(99)
      expect(fn).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('b')
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs immediately only on the leading edge when immediate is enabled', async () => {
    vi.useFakeTimers()
    try {
      const { debounce } = await import('../index')
      const fn = vi.fn()
      const debounced = debounce(fn, 100, true)

      debounced('a')
      debounced('b')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('a')

      await vi.advanceTimersByTimeAsync(100)
      debounced('c')
      expect(fn).toHaveBeenCalledTimes(2)
      expect(fn).toHaveBeenLastCalledWith('c')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not keep the process alive for pending debounce work', async () => {
    const unref = vi.fn()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((_callback, timeout) => {
      expect(timeout).toBe(100)
      return { unref } as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)

    try {
      const { debounce } = await import('../index')
      const debounced = debounce(vi.fn(), 100)

      debounced()

      expect(timeoutSpy).toHaveBeenCalledTimes(1)
      expect(unref).toHaveBeenCalledTimes(1)
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})
