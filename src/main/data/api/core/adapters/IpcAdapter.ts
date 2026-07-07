import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'
import { DataApiErrorFactory, ErrorCode, toDataApiError } from '@shared/data/api/errors'
import type { DataRequest, DataResponse, HttpMethod } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import type { ApiServer } from '../ApiServer'

const logger = loggerService.withContext('DataApi:IpcAdapter')
const HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
const MALFORMED_REQUEST_ID = 'malformed-data-api-request'

function extractRequestId(request: unknown): string {
  if (request && typeof request === 'object' && typeof (request as Record<string, unknown>).id === 'string') {
    return (request as Record<string, string>).id
  }

  return MALFORMED_REQUEST_ID
}

function isDataRequest(request: unknown): request is DataRequest {
  if (!request || typeof request !== 'object') return false

  const candidate = request as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.method === 'string' &&
    HTTP_METHODS.has(candidate.method as HttpMethod)
  )
}

function createBadRequestResponse(request: unknown): DataResponse {
  const apiError = DataApiErrorFactory.create(ErrorCode.BAD_REQUEST, 'Malformed Data API request')

  return {
    id: extractRequestId(request),
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
      try {
        if (!isDataRequest(request)) {
          return createBadRequestResponse(request)
        }

        const response = await this.apiServer.handleRequest(request)

        return response
      } catch (error) {
        const requestContext = isDataRequest(request)
          ? `${request.method} ${request.path}`
          : 'malformed Data API request'
        logger.error(`Data request failed: ${requestContext}`, error as Error)

        const apiError = toDataApiError(error, requestContext)
        const errorResponse: DataResponse = {
          id: extractRequestId(request),
          status: apiError.status,
          error: apiError.toJSON(), // Serialize for IPC transmission
          metadata: {
            duration: 0,
            timestamp: Date.now()
          }
        }

        return errorResponse
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
