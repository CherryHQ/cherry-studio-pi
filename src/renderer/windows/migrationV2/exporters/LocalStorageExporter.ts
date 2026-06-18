import type { LocalStorageRecord } from '@shared/data/migration/v2/types'

import { getLocalStorageKey, getLocalStorageLength, readLocalStorageItem } from './localStorageAccess'

export class LocalStorageExporter {
  private exportPath: string
  private exportedCount = 0

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  async export(): Promise<string> {
    const records: LocalStorageRecord[] = []
    const entryCount = getLocalStorageLength('LocalStorageExporter.export')

    for (let i = 0; i < entryCount; i++) {
      const key = getLocalStorageKey('LocalStorageExporter.export', i)
      if (key === null) continue

      const rawValue = readLocalStorageItem('LocalStorageExporter.export', key)
      if (rawValue === null) continue

      let value: unknown = rawValue

      // Try to parse JSON values
      try {
        value = JSON.parse(rawValue)
      } catch {
        // Keep as string if not valid JSON
      }

      records.push({ key, value })
    }

    this.exportedCount = records.length

    // Write via IPC (reuse existing WriteExportFile channel)
    await window.electron.ipcRenderer.invoke(
      'migration:write-export-file',
      this.exportPath,
      'localStorage',
      JSON.stringify(records)
    )

    return `${this.exportPath}/localStorage.json`
  }

  hasData(): boolean {
    return getLocalStorageLength('LocalStorageExporter.hasData') > 0
  }

  getEntryCount(): number {
    return this.exportedCount
  }
}
