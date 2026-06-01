import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import {
  type SystemAgentCapabilityCallOptions,
  type SystemAgentEventInput,
  type SystemAgentPlanIntentInput,
  systemAgentRuntimeService
} from './SystemAgentRuntimeService'

let registered = false

export function registerSystemAgentIpcHandlers() {
  if (registered) return
  registered = true

  ipcMain.handle(IpcChannel.SystemAgent_ListCapabilities, (_, options = {}) =>
    systemAgentRuntimeService.listCapabilities(options)
  )
  ipcMain.handle(IpcChannel.SystemAgent_PlanIntent, (_, input: SystemAgentPlanIntentInput) =>
    systemAgentRuntimeService.planIntent(input)
  )
  ipcMain.handle(IpcChannel.SystemAgent_PlanEvent, (_, input: SystemAgentEventInput) =>
    systemAgentRuntimeService.planEvent(input)
  )
  ipcMain.handle(
    IpcChannel.SystemAgent_CallCapability,
    (_, id: string, input: unknown = {}, options: SystemAgentCapabilityCallOptions = {}) =>
      systemAgentRuntimeService.callCapability(id, input, options)
  )
}
