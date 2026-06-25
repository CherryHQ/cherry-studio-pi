import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchModels } from '../ApiService'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  listModels: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: vi.fn()
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (_route: string, input: unknown) => mocks.listModels(input)
  }
}))

vi.mock('../ModelService', () => ({
  readDefaultModel: vi.fn(),
  readQuickModel: vi.fn()
}))

describe('ApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves nested model listing errors in logs', async () => {
    const provider = { id: 'provider-1', name: 'Provider One' } as Provider
    mocks.listModels.mockRejectedValueOnce({ error: { message: 'provider model endpoint failed' } })

    await expect(fetchModels(provider)).resolves.toEqual([])

    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to fetch models from provider', {
      providerId: 'provider-1',
      providerName: 'Provider One',
      error: 'provider model endpoint failed'
    })
  })
})
