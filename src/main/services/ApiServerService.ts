import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  ApiServerConfig,
  GetApiServerStatusResult,
  RestartApiServerStatusResult,
  StartApiServerStatusResult,
  StopApiServerStatusResult
} from '@types'
import { v4 as uuidv4 } from 'uuid'

import { ApiServer } from '../apiServer'
import { summarizeApiServerConfigForLog } from '../apiServer/logging'

const logger = loggerService.withContext('ApiServerService')

@Injectable('ApiServerService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['MainWindowService'])
export class ApiServerService extends BaseService implements Activatable {
  private apiServer: ApiServer | null = null
  private configChangeQueue: Promise<void> = Promise.resolve()

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    this.registerPreferenceListeners()
  }

  protected async onReady(): Promise<void> {
    const shouldStart = await this.shouldAutoStart()
    if (shouldStart) {
      await this.activate()
    }
  }

  async onActivate(): Promise<void> {
    try {
      await this.ensureValidApiKey()
      this.apiServer = new ApiServer()
      await this.apiServer.start()
      logger.info('API Server activated')
    } catch (error) {
      // Activatable failure contract: clean up partial state before throwing
      if (this.apiServer) {
        await this.apiServer.stop().catch(() => {})
        this.apiServer = null
      }
      throw error
    }
  }

  async onDeactivate(): Promise<void> {
    if (this.apiServer) {
      await this.apiServer.stop()
      this.apiServer = null
    }
    logger.info('API Server deactivated')
  }

  async start(): Promise<void> {
    try {
      await this.activate()
      logger.info('API Server started successfully')
    } catch (error: any) {
      logger.error('Failed to start API Server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      await this.deactivate()
      logger.info('API Server stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Server:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    try {
      await this.deactivate()
      await this.activate()
      logger.info('API Server restarted successfully')
    } catch (error: any) {
      logger.error('Failed to restart API Server:', error)
      throw error
    }
  }

  isRunning(): boolean {
    return this.apiServer?.isRunning() ?? false
  }

  getCurrentConfig(): ApiServerConfig {
    const config = application.get('PreferenceService').getMultiple({
      enabled: 'feature.csaas.enabled',
      host: 'feature.csaas.host',
      port: 'feature.csaas.port',
      apiKey: 'feature.csaas.api_key'
    }) as ApiServerConfig

    return config
  }

  async ensureValidApiKey(): Promise<string> {
    const preferenceService = application.get('PreferenceService')
    let apiKey = preferenceService.get('feature.csaas.api_key')
    if (apiKey === null) {
      apiKey = `cs-sk-${uuidv4()}`
      await preferenceService.set('feature.csaas.api_key', apiKey)
      logger.info('Generated new API key')
    }
    return apiKey
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.ApiServer_Start, async (): Promise<StartApiServerStatusResult> => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_Stop, async (): Promise<StopApiServerStatusResult> => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_Restart, async (): Promise<RestartApiServerStatusResult> => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_GetStatus, (): GetApiServerStatusResult => {
      try {
        const config = this.getCurrentConfig()
        return {
          running: this.isRunning(),
          config
        }
      } catch (error: any) {
        logger.error('IpcChannel.ApiServer_GetStatus', error as Error)
        return {
          running: this.isRunning(),
          config: null
        }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_GetConfig, () => {
      try {
        return this.getCurrentConfig()
      } catch (error: any) {
        return null
      }
    })
  }

  private registerPreferenceListeners(): void {
    const preferenceService = application.get('PreferenceService')

    this.registerDisposable(
      preferenceService.subscribeChange('feature.csaas.enabled', (enabled) => {
        this.queueConfigChange('enabled toggled', async () => {
          if (enabled) {
            if (!this.isRunning()) {
              await this.start()
            }
            return
          }

          if (this.isRunning()) {
            await this.stop()
          }
        })
      })
    )

    this.registerDisposable(
      preferenceService.subscribeMultipleChanges(['feature.csaas.host', 'feature.csaas.port'], () => {
        this.queueConfigChange('host or port changed', async () => {
          if (this.isRunning()) {
            await this.restart()
          }
        })
      })
    )
  }

  private queueConfigChange(reason: string, task: () => Promise<void>): void {
    this.configChangeQueue = this.configChangeQueue
      .catch(() => undefined)
      .then(async () => {
        logger.info('Applying API server preference change', { reason })
        await task()
      })
      .catch((error) => {
        logger.error('Failed to apply API server preference change:', error as Error, { reason })
      })
  }

  private async shouldAutoStart(): Promise<boolean> {
    try {
      const config = this.getCurrentConfig()
      logger.info('API server config:', summarizeApiServerConfigForLog(config))

      if (config.enabled) {
        return true
      }

      try {
        const { total } = await agentService.listAgents({ limit: 1 })
        if (total > 0) {
          logger.info(`Detected ${total} agent(s), auto-starting API server`)
          return true
        }
      } catch (error: any) {
        logger.warn('Failed to check agent count:', error)
      }

      return false
    } catch (error: any) {
      logger.error('Failed to check API server auto-start condition:', error)
      return false
    }
  }
}
