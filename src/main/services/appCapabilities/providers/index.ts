import type { AppCapabilityRegistry } from '../registry'
import { createAgentCapabilities } from './agents'
import { createDataSyncCapabilities } from './dataSync'
import { createKnowledgeCapabilities } from './knowledge'
import { createMcpCapabilities } from './mcp'
import { createNavigationCapabilities } from './navigation'
import { createNotesCapabilities } from './notes'
import { createPaintingCapabilities } from './paintings'
import { createSettingsCapabilities } from './settings'
import { createStorageCapabilities } from './storage'

export function registerAppCapabilities(registry: AppCapabilityRegistry): void {
  registry.registerMany([
    ...createNavigationCapabilities(),
    ...createSettingsCapabilities(),
    ...createDataSyncCapabilities(),
    ...createStorageCapabilities(),
    ...createKnowledgeCapabilities(),
    ...createMcpCapabilities(),
    ...createNotesCapabilities(),
    ...createPaintingCapabilities(),
    ...createAgentCapabilities()
  ])
}
