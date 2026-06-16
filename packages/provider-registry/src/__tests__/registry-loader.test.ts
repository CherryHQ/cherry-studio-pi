import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { RegistryLoader } from '../registry-loader'

const dataPath = (fileName: string) => fileURLToPath(new URL(`../../data/${fileName}`, import.meta.url))

describe('RegistryLoader', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not keep the process alive with the idle expiry timer', () => {
    const unref = vi.fn()
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)

    const loader = new RegistryLoader(
      {
        models: dataPath('models.json'),
        providers: dataPath('providers.json'),
        providerModels: dataPath('provider-models.json')
      },
      12_345
    )

    expect(loader.loadModels().length).toBeGreaterThan(0)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12_345)
    expect(unref).toHaveBeenCalledTimes(1)

    loader.invalidate()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
  })
})
