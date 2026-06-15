import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'
import { DataApiErrorFactory, ErrorCode, toDataApiError } from '@shared/data/api/apiErrors'
import type { DataRequest, DataResponse, HttpMethod } from '@shared/data/api/apiTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import type { ApiServer } from '../ApiServer'

const logger = loggerService.withContext('DataApi:IpcAdapter')
const MALFORMED_REQUEST_ID = 'malformed-data-api-request'
const DATA_API_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getRequestLogContext(request: unknown) {
  const record = isPlainRecord(request) ? request : {}
  const id = typeof record.id === 'string' && record.id ? record.id : MALFORMED_REQUEST_ID
  const method = typeof record.method === 'string' && record.method ? record.method : 'UNKNOWN'
  const path = typeof record.path === 'string' && record.path ? record.path : '<unknown>'

  return {
    id,
    label: `${method} ${path}`
  }
}

function isDataRequest(value: unknown): value is DataRequest {
  if (!isPlainRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.method === 'string' &&
    DATA_API_METHODS.has(value.method as HttpMethod) &&
    typeof value.path === 'string' &&
    value.path.length > 0
  )
}

function dataApiErrorResponse(id: string, error: unknown, context: string): DataResponse {
  const apiError = toDataApiError(error, context)
  return {
    id,
    status: apiError.status,
    error: apiError.toJSON(),
    metadata: {
      duration: 0,
      timestamp: Date.now()
    }
  }
}

/**
 * IPC transport adapter for Electron environment.
 *
 * ## Why a separate adapter instead of BaseService.ipcHandle()?
 *
 * ApiServer is designed as a transport-agnostic request processor — it only
 * knows DataRequest → DataResponse, with no dependency on Electron IPC.
 *
 * Adapters are the bridge between a specific transport and ApiServer:
 * - **IpcAdapter** (this file): bridges Electron IPC ↔ ApiServer
 * - **HttpAdapter** (planned): will bridge Express HTTP ↔ ApiServer
 *
 * If these handlers were registered directly via BaseService.ipcHandle() in
 * DataApiService, the transport-specific protocol conversion (error wrapping,
 * serialization) would leak into the coordinator, and adding a new transport
 * would require modifying DataApiService internals.
 *
 * Each adapter implements Disposable so DataApiService can track cleanup via
 * registerDisposable() — no manual teardown code needed.
 */
export class IpcAdapter implements Disposable {
  private initialized = false

  constructor(private apiServer: ApiServer) {}

  /**
   * Register IPC handlers to bridge renderer requests to ApiServer
   */
  setup(): void {
    if (this.initialized) {
      logger.warn('IPC handlers already initialized')
      return
    }

    // Main data request handler
    ipcMain.handle(IpcChannel.DataApi_Request, async (_event, request: unknown): Promise<DataResponse> => {
      const requestContext = getRequestLogContext(request)
      if (!isDataRequest(request)) {
        logger.warn(`Rejected malformed data request: ${requestContext.label}`, { id: requestContext.id })
        const badRequest = DataApiErrorFactory.create(ErrorCode.BAD_REQUEST, 'Malformed Data API request', {
          reason: 'Request must include a non-empty id, valid method, and non-empty path'
        })
        return dataApiErrorResponse(requestContext.id, badRequest, requestContext.label)
      }

      try {
        const response = await this.apiServer.handleRequest(request)

        return response
      } catch (error) {
        logger.error(`Data request failed: ${requestContext.label}`, error as Error)
        return dataApiErrorResponse(requestContext.id, error, requestContext.label)
      }
    })

    // Subscription handlers (placeholder for future real-time features)
    ipcMain.handle(IpcChannel.DataApi_Subscribe, async (_event, path: string) => {
      logger.debug(`Data subscription request: ${path}`)
      // TODO: Implement real-time subscriptions
      return { success: true, subscriptionId: `sub_${Date.now()}` }
    })

    ipcMain.handle(IpcChannel.DataApi_Unsubscribe, async (_event, subscriptionId: string) => {
      logger.debug(`Data unsubscription request: ${subscriptionId}`)
      // TODO: Implement real-time subscriptions
      return { success: true }
    })

    this.initialized = true
  }

  /**
   * Remove IPC handlers — implements Disposable for automatic lifecycle cleanup
   */
  dispose(): void {
    if (!this.initialized) {
      return
    }

    logger.debug('Removing IPC handlers...')

    ipcMain.removeHandler(IpcChannel.DataApi_Request)
    ipcMain.removeHandler(IpcChannel.DataApi_Subscribe)
    ipcMain.removeHandler(IpcChannel.DataApi_Unsubscribe)

    this.initialized = false
    logger.debug('IPC handlers removed')
  }
}
