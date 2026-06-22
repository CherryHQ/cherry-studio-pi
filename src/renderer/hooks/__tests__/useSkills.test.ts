import type { InstalledSkill, LocalSkill, SkillSearchResult } from '@renderer/types'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useQueryMock = vi.hoisted(() => vi.fn())
const invalidateMock = vi.hoisted(() => vi.fn())
const searchSkillsMock = vi.hoisted(() => vi.fn())
const toggleSkillMock = vi.hoisted(() => vi.fn())
const uninstallSkillMock = vi.hoisted(() => vi.fn())
const installSkillMock = vi.hoisted(() => vi.fn())
const installSkillFromZipMock = vi.hoisted(() => vi.fn())
const installSkillFromDirectoryMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: useQueryMock,
  useInvalidateCache: () => invalidateMock
}))

vi.mock('@renderer/services/SkillSearchService', () => ({
  searchSkills: searchSkillsMock
}))

import { buildAvailableSkills, useInstalledSkills, useSkillInstall, useSkillSearch } from '../useSkills'

function createSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: 'skill-1',
    name: 'Skill One',
    description: 'First skill',
    folderName: 'skill-one',
    source: 'builtin',
    sourceUrl: null,
    namespace: null,
    author: null,
    sourceTags: [],
    contentHash: 'hash-1',
    isEnabled: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

function createSearchResult(name: string): SkillSearchResult {
  return {
    slug: name.toLowerCase(),
    name,
    description: null,
    author: null,
    stars: 0,
    downloads: 0,
    sourceRegistry: 'skills.sh',
    sourceUrl: null,
    installSource: `skills.sh:${name.toLowerCase()}`
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('useSkillSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aborts a stale search when a newer query starts', async () => {
    const pendingSearches: Array<{
      query: string
      signal?: AbortSignal
      resolve: (results: SkillSearchResult[]) => void
    }> = []

    searchSkillsMock.mockImplementation(
      (query: string, options?: { signal?: AbortSignal }) =>
        new Promise<SkillSearchResult[]>((resolve) => {
          pendingSearches.push({ query, signal: options?.signal, resolve })
        })
    )

    const { result } = renderHook(() => useSkillSearch())
    let firstSearch = Promise.resolve()
    let secondSearch = Promise.resolve()

    act(() => {
      firstSearch = result.current.search('alpha')
    })

    expect(pendingSearches[0].query).toBe('alpha')
    expect(pendingSearches[0].signal?.aborted).toBe(false)

    act(() => {
      secondSearch = result.current.search('beta')
    })

    expect(pendingSearches[0].signal?.aborted).toBe(true)
    expect(pendingSearches[1].query).toBe('beta')
    expect(pendingSearches[1].signal?.aborted).toBe(false)

    await act(async () => {
      pendingSearches[0].resolve([createSearchResult('Alpha')])
      await firstSearch
    })

    expect(result.current.results).toEqual([])
    expect(result.current.searching).toBe(true)

    await act(async () => {
      pendingSearches[1].resolve([createSearchResult('Beta')])
      await secondSearch
    })

    expect(result.current.results).toEqual([createSearchResult('Beta')])
    expect(result.current.searching).toBe(false)
  })

  it('aborts the current search when clearing results', async () => {
    let capturedSignal: AbortSignal | undefined
    let resolveSearch: ((results: SkillSearchResult[]) => void) | undefined
    searchSkillsMock.mockImplementation(
      (_query: string, options?: { signal?: AbortSignal }) =>
        new Promise<SkillSearchResult[]>((resolve) => {
          capturedSignal = options?.signal
          resolveSearch = resolve
        })
    )

    const { result } = renderHook(() => useSkillSearch())
    let searchPromise = Promise.resolve()

    act(() => {
      searchPromise = result.current.search('alpha')
    })

    expect(result.current.searching).toBe(true)
    expect(capturedSignal?.aborted).toBe(false)

    act(() => {
      result.current.clear()
    })

    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.results).toEqual([])
    expect(result.current.searching).toBe(false)

    await act(async () => {
      resolveSearch?.([createSearchResult('Alpha')])
      await searchPromise
    })

    expect(result.current.results).toEqual([])
    expect(result.current.searching).toBe(false)
  })

  it('aborts the current search on unmount', () => {
    let capturedSignal: AbortSignal | undefined
    searchSkillsMock.mockImplementation(
      (_query: string, options?: { signal?: AbortSignal }) =>
        new Promise<SkillSearchResult[]>(() => {
          capturedSignal = options?.signal
        })
    )

    const { result, unmount } = renderHook(() => useSkillSearch())

    act(() => {
      void result.current.search('alpha')
    })

    expect(capturedSignal?.aborted).toBe(false)

    unmount()

    expect(capturedSignal?.aborted).toBe(true)
  })
})

describe('useInstalledSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const skills = [
      createSkill(),
      createSkill({ id: 'skill-2', name: 'Skill Two', folderName: 'skill-two', contentHash: 'hash-2' })
    ]

    useQueryMock.mockReturnValue({
      data: skills,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    })

    invalidateMock.mockResolvedValue(undefined)
    toggleSkillMock.mockImplementation(async ({ skillId, isEnabled }) => ({
      success: true,
      data: createSkill({ id: skillId, isEnabled, updatedAt: '2024-01-02T00:00:00.000Z' })
    }))
    uninstallSkillMock.mockResolvedValue({ success: true, data: undefined })

    vi.stubGlobal('api', {
      skill: {
        toggle: toggleSkillMock,
        uninstall: uninstallSkillMock
      }
    })
    vi.stubGlobal('toast', { error: toastErrorMock })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads skills with DataApi and toggles agent skill through IPC', async () => {
    const { result } = renderHook(() => useInstalledSkills('agent-1'))

    expect(result.current.skills).toHaveLength(2)
    expect(useQueryMock).toHaveBeenCalledWith('/skills', { query: { agentId: 'agent-1' } })

    let toggleSuccess = false
    await act(async () => {
      toggleSuccess = await result.current.toggle('skill-1', true)
    })

    expect(toggleSuccess).toBe(true)
    expect(toggleSkillMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      skillId: 'skill-1',
      isEnabled: true
    })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('uninstalls skills through IPC and invalidates DataApi cache', async () => {
    const { result } = renderHook(() => useInstalledSkills())

    let uninstallSuccess = false
    await act(async () => {
      uninstallSuccess = await result.current.uninstall('skill-1')
    })

    expect(uninstallSuccess).toBe(true)
    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('does not fail uninstall when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useInstalledSkills())

    let uninstallSuccess = false
    await act(async () => {
      uninstallSuccess = await result.current.uninstall('skill-1')
    })

    expect(uninstallSuccess).toBe(true)
    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('does not toggle when no agent context is provided', async () => {
    const { result } = renderHook(() => useInstalledSkills())

    let toggleSuccess = true
    await act(async () => {
      toggleSuccess = await result.current.toggle('skill-1', true)
    })

    expect(toggleSuccess).toBe(false)
    expect(toggleSkillMock).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('logs, toasts, and rethrows toggle and uninstall failures', async () => {
    const { result } = renderHook(() => useInstalledSkills('agent-1'))

    toggleSkillMock.mockRejectedValueOnce(new Error('toggle failed'))
    await act(async () => {
      await expect(result.current.toggle('skill-1', true)).rejects.toThrow('toggle failed')
    })
    expect(toastErrorMock).toHaveBeenCalledWith('toggle failed')

    uninstallSkillMock.mockResolvedValueOnce({ success: false, error: 'uninstall failed' })
    await act(async () => {
      await expect(result.current.uninstall('skill-1')).rejects.toThrow('uninstall failed')
    })
    expect(toastErrorMock).toHaveBeenCalledWith('uninstall failed')
  })
})

describe('useSkillInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    })
    invalidateMock.mockResolvedValue(undefined)
    installSkillMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-installed' }) })
    installSkillFromZipMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-zip' }) })
    installSkillFromDirectoryMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-directory' }) })

    vi.stubGlobal('api', {
      skill: {
        install: installSkillMock,
        installFromZip: installSkillFromZipMock,
        installFromDirectory: installSkillFromDirectoryMock
      }
    })
    vi.stubGlobal('toast', { error: toastErrorMock })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('installs remote skills through IPC with installSource', async () => {
    const { result } = renderHook(() => useSkillInstall())

    await act(async () => {
      const { skill } = await result.current.install('skills.sh:owner/repo/my-skill')
      expect(skill?.id).toBe('skill-installed')
    })

    expect(installSkillMock).toHaveBeenCalledWith({ installSource: 'skills.sh:owner/repo/my-skill' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('returns installed skill when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useSkillInstall())

    let installResult: Awaited<ReturnType<typeof result.current.install>> | undefined
    await act(async () => {
      installResult = await result.current.install('skills.sh:owner/repo/my-skill')
    })

    expect(installResult?.skill?.id).toBe('skill-installed')
    expect(installResult?.error).toBeUndefined()
    expect(installSkillMock).toHaveBeenCalledWith({ installSource: 'skills.sh:owner/repo/my-skill' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('installs local ZIP and directory skills through IPC', async () => {
    const { result } = renderHook(() => useSkillInstall())

    await act(async () => {
      await result.current.installFromZip('/tmp/my-skill.zip')
      await result.current.installFromDirectory('/tmp/my-skill')
    })

    expect(installSkillFromZipMock).toHaveBeenCalledWith({ zipFilePath: '/tmp/my-skill.zip' })
    expect(installSkillFromDirectoryMock).toHaveBeenCalledWith({ directoryPath: '/tmp/my-skill' })
    expect(invalidateMock).toHaveBeenCalledTimes(2)
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('keeps installing key for the latest overlapping install', async () => {
    const remoteInstall = deferred<{ success: true; data: InstalledSkill }>()
    const zipInstall = deferred<{ success: true; data: InstalledSkill }>()
    installSkillMock.mockReturnValueOnce(remoteInstall.promise)
    installSkillFromZipMock.mockReturnValueOnce(zipInstall.promise)

    const { result } = renderHook(() => useSkillInstall())

    let remoteInstallPromise!: ReturnType<typeof result.current.install>
    let zipInstallPromise!: ReturnType<typeof result.current.installFromZip>
    await act(async () => {
      remoteInstallPromise = result.current.install('skills.sh:owner/repo/remote-skill')
      zipInstallPromise = result.current.installFromZip('/tmp/local-skill.zip')
      await Promise.resolve()
    })

    expect(result.current.installingKey).toBe('zip')
    expect(result.current.isInstalling('skills.sh:owner/repo/remote-skill')).toBe(false)
    expect(result.current.isInstalling('zip')).toBe(true)

    await act(async () => {
      remoteInstall.resolve({ success: true, data: createSkill({ id: 'skill-remote' }) })
      await remoteInstallPromise
    })

    expect(result.current.installingKey).toBe('zip')
    expect(result.current.isInstalling('zip')).toBe(true)

    await act(async () => {
      zipInstall.resolve({ success: true, data: createSkill({ id: 'skill-zip' }) })
      await zipInstallPromise
    })

    expect(result.current.installingKey).toBeNull()
    expect(result.current.isInstalling()).toBe(false)
  })

  it('logs, toasts, and rethrows local ZIP and directory install failures', async () => {
    const { result } = renderHook(() => useSkillInstall())

    installSkillFromZipMock.mockRejectedValueOnce(new Error('zip failed'))
    await act(async () => {
      await expect(result.current.installFromZip('/tmp/bad.zip')).rejects.toThrow('zip failed')
    })
    expect(toastErrorMock).toHaveBeenCalledWith('zip failed')

    installSkillFromDirectoryMock.mockResolvedValueOnce({ success: false, error: 'directory failed' })
    await act(async () => {
      await expect(result.current.installFromDirectory('/tmp/bad-dir')).rejects.toThrow('directory failed')
    })
    expect(toastErrorMock).toHaveBeenCalledWith('directory failed')
  })
})

describe('buildAvailableSkills', () => {
  it('includes only enabled global skills', () => {
    const result = buildAvailableSkills(
      [
        createSkill({ folderName: 'enabled', name: 'Enabled', isEnabled: true }),
        createSkill({ folderName: 'disabled', name: 'Disabled', isEnabled: false })
      ],
      []
    )

    expect(result).toEqual([{ name: 'Enabled', description: 'First skill', filename: 'enabled' }])
  })

  it('lets an enabled global win over a same-filename local and keeps local-only skills', () => {
    const result = buildAvailableSkills(
      [createSkill({ folderName: 'shared', name: 'Global Shared', isEnabled: true })],
      [
        { name: 'Local Shared', description: 'shadowed', filename: 'shared' },
        { name: 'Local Only', description: 'kept', filename: 'unique' }
      ] as LocalSkill[]
    )

    expect(result).toEqual([
      { name: 'Global Shared', description: 'First skill', filename: 'shared' },
      { name: 'Local Only', description: 'kept', filename: 'unique' }
    ])
  })
})
