import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalStorageExporter } from '../LocalStorageExporter'

const loggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarn
    })
  }
}))

describe('LocalStorageExporter', () => {
  const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron')
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          invoke
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    loggerWarn.mockClear()
    localStorage.clear()
    if (originalElectron) {
      Object.defineProperty(window, 'electron', originalElectron)
    } else {
      Reflect.deleteProperty(window, 'electron')
    }
  })

  it('exports localStorage entries through the migration IPC channel', async () => {
    localStorage.setItem('plain', 'hello')
    localStorage.setItem('json', JSON.stringify({ enabled: true }))

    const exporter = new LocalStorageExporter('/tmp/migration/localstorage_export')

    await expect(exporter.export()).resolves.toBe('/tmp/migration/localstorage_export/localStorage.json')

    expect(invoke).toHaveBeenCalledWith(
      'migration:write-export-file',
      '/tmp/migration/localstorage_export',
      'localStorage',
      expect.any(String)
    )
    const records = JSON.parse(invoke.mock.calls[0][3])
    expect(records).toEqual(
      expect.arrayContaining([
        { key: 'plain', value: 'hello' },
        { key: 'json', value: { enabled: true } }
      ])
    )
    expect(exporter.getEntryCount()).toBe(2)
  })

  it('skips unreadable entries instead of failing the export', async () => {
    localStorage.setItem('good', 'kept')
    localStorage.setItem('bad', 'blocked')
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(this: Storage, key: string) {
      if (key === 'bad') {
        throw new DOMException('Blocked', 'SecurityError')
      }
      return originalGetItem.call(this, key)
    })

    const exporter = new LocalStorageExporter('/tmp/migration/localstorage_export')
    await exporter.export()

    const records = JSON.parse(invoke.mock.calls[0][3])
    expect(records).toEqual([{ key: 'good', value: 'kept' }])
    expect(exporter.getEntryCount()).toBe(1)
    expect(loggerWarn).toHaveBeenCalledWith(
      'LocalStorageExporter.export: Failed to read localStorage item bad',
      expect.objectContaining({ name: 'SecurityError' })
    )
  })

  it('exports an empty file when localStorage length is blocked', async () => {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          throw new DOMException('Blocked', 'SecurityError')
        },
        getItem: vi.fn(),
        key: vi.fn()
      }
    })

    try {
      const exporter = new LocalStorageExporter('/tmp/migration/localstorage_export')

      expect(exporter.hasData()).toBe(false)
      await exporter.export()

      expect(JSON.parse(invoke.mock.calls[0][3])).toEqual([])
      expect(loggerWarn).toHaveBeenCalledWith(
        'LocalStorageExporter.hasData: Failed to read localStorage length',
        expect.objectContaining({ name: 'SecurityError' })
      )
    } finally {
      if (originalLocalStorage) {
        Object.defineProperty(window, 'localStorage', originalLocalStorage)
      }
    }
  })
})
