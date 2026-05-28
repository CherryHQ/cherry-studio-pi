import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fs: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn()
  },
  getPath: vi.fn(),
  getAppPath: vi.fn()
}))

vi.mock('node:fs', () => ({
  ...mocks.fs,
  default: mocks.fs
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: mocks.getAppPath,
    getPath: mocks.getPath
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
    mocks.fs.existsSync.mockReturnValue(false)
    mocks.fs.mkdirSync.mockReturnValue(undefined as never)
    mocks.fs.readFileSync.mockReturnValue('{}')
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

  it('uses an existing legacy root when the current renamed root is empty', async () => {
    const legacyRoot = '/mock/appData/Perry Studio/Data'
    mocks.fs.existsSync.mockImplementation((candidate) =>
      [legacyRoot, `${legacyRoot}/agents.db`].includes(String(candidate))
    )

    const { getDataPath } = await import('../index')

    expect(getDataPath()).toBe(legacyRoot)
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
