import { afterEach, describe, expect, it, vi } from 'vitest'

import { storageV2AgentDbMirrorService } from '../AgentDbMirrorService'
import { storageV2LegacyAgentDbImportService } from '../LegacyAgentDbImportService'

describe('StorageV2AgentDbMirrorService', () => {
  afterEach(async () => {
    await storageV2AgentDbMirrorService.flush()
    vi.restoreAllMocks()
  })

  it('mirrors runtime agent changes without creating migration snapshots', async () => {
    const importSnapshot = vi.spyOn(storageV2LegacyAgentDbImportService, 'importSnapshot').mockResolvedValue({} as any)

    storageV2AgentDbMirrorService.schedule(0)
    await storageV2AgentDbMirrorService.flush()

    expect(importSnapshot).toHaveBeenCalledWith({ dryRun: false, createSnapshot: false })
  })
})
