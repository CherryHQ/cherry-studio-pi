import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifyStorageV2MirroredLocalStorageKeyChangedMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/StorageV2LocalStorageSnapshot', () => ({
  notifyStorageV2MirroredLocalStorageKeyChanged: notifyStorageV2MirroredLocalStorageKeyChangedMock
}))

function stubLocalStorage(overrides: Partial<Storage> = {}) {
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
    ...overrides
  } as Storage

  vi.stubGlobal('localStorage', storage)
  return storage
}

describe('memory store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('can be imported without localStorage', async () => {
    vi.stubGlobal('localStorage', undefined)

    const memory = await import('../memory')

    expect(memory.initialState.currentUserId).toBe('default-user')
  })

  it('loads, persists, and mirrors the current memory user id', async () => {
    const storage = stubLocalStorage({
      getItem: vi.fn(() => 'stored-user')
    })

    const memory = await import('../memory')
    const state = memory.default(undefined, { type: '@@INIT' })
    const nextState = memory.default(state, memory.setCurrentUserId('next-user'))

    expect(state.currentUserId).toBe('stored-user')
    expect(nextState.currentUserId).toBe('next-user')
    expect(storage.setItem).toHaveBeenCalledWith('memory_currentUserId', 'next-user')
    expect(notifyStorageV2MirroredLocalStorageKeyChangedMock).toHaveBeenCalledWith('memory_currentUserId')
  })

  it('keeps Redux state updates working when localStorage writes fail', async () => {
    stubLocalStorage({
      setItem: vi.fn(() => {
        throw new Error('storage blocked')
      })
    })

    const memory = await import('../memory')

    expect(() => memory.default(undefined, memory.setCurrentUserId('next-user'))).not.toThrow()
    expect(memory.default(undefined, memory.setCurrentUserId('next-user')).currentUserId).toBe('next-user')
    expect(notifyStorageV2MirroredLocalStorageKeyChangedMock).not.toHaveBeenCalled()
  })
})
