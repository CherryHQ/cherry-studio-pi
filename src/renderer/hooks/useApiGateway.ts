import { cacheService } from '@data/CacheService'
import { useSharedCache } from '@data/hooks/useCache'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const API_GATEWAY_PREFERENCE_KEYS = {
  enabled: 'feature.api_gateway.enabled',
  host: 'feature.api_gateway.host',
  port: 'feature.api_gateway.port',
  apiKey: 'feature.api_gateway.api_key'
} as const

/**
 * API Gateway hook.
 *
 * - Config flows through the DataApi preference layer (`feature.api_gateway.*`).
 * - Running state is published by Main to the shared cache (Main is
 *   authoritative); the renderer reads it reactively via `useSharedCache`.
 *   No IPC ready-broadcast or EventEmitter listener is involved.
 * - Start/stop/restart remain imperative IPC commands; Main updates the shared
 *   cache as part of activation, so `apiGatewayRunning` updates on its own.
 */
export const useApiGateway = () => {
  const { t } = useTranslation()

  const [apiGatewayConfig, setApiGatewayConfig] = useMultiplePreferences(API_GATEWAY_PREFERENCE_KEYS)

  const [apiGatewayRunning] = useSharedCache('feature.api_gateway.running', false)

  // Tracks an in-flight start/stop/restart command (for button spinners) AND the
  // initial shared-cache hydration window. Starts `true` until the shared cache is
  // ready, so consumers (e.g. AgentPage) don't transiently read the default
  // `running=false` and flash a "server stopped" screen before Main's value arrives.
  const [apiGatewayLoading, setApiGatewayLoading] = useState(() => !cacheService.isSharedCacheReady())
  const mountedRef = useRef(true)
  const operationRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (cacheService.isSharedCacheReady()) {
      setApiGatewayLoading(false)
      return
    }

    return cacheService.onSharedCacheReady(() => {
      if (mountedRef.current) {
        setApiGatewayLoading(false)
      }
    })
  }, [])

  const setApiGatewayEnabled = useCallback(
    (enabled: boolean) => setApiGatewayConfig({ enabled }),
    [setApiGatewayConfig]
  )

  const beginOperation = useCallback(() => {
    if (operationRef.current || apiGatewayLoading) {
      return false
    }

    operationRef.current = true
    setApiGatewayLoading(true)
    return true
  }, [apiGatewayLoading])

  const finishOperation = useCallback(() => {
    operationRef.current = false
    if (mountedRef.current) {
      setApiGatewayLoading(false)
    }
  }, [])

  const showSuccess = useCallback(
    (messageKey: string) => {
      if (mountedRef.current) {
        window.toast.success(t(messageKey))
      }
    },
    [t]
  )

  const showError = useCallback((message: string) => {
    if (mountedRef.current) {
      window.toast.error(message)
    }
  }, [])

  const startApiGateway = useCallback(async () => {
    if (!beginOperation()) return
    try {
      const result = await window.api.apiGateway.start()
      if (result.success) {
        await setApiGatewayEnabled(true)
        showSuccess('apiGateway.messages.startSuccess')
      } else {
        showError(t('apiGateway.messages.startError') + result.error)
      }
    } catch (error: any) {
      showError(t('apiGateway.messages.startError') + (error.message || error))
    } finally {
      finishOperation()
    }
  }, [beginOperation, finishOperation, setApiGatewayEnabled, showError, showSuccess, t])

  const stopApiGateway = useCallback(async () => {
    if (!beginOperation()) return
    try {
      const result = await window.api.apiGateway.stop()
      if (result.success) {
        await setApiGatewayEnabled(false)
        showSuccess('apiGateway.messages.stopSuccess')
      } else {
        showError(t('apiGateway.messages.stopError') + result.error)
      }
    } catch (error: any) {
      showError(t('apiGateway.messages.stopError') + (error.message || error))
    } finally {
      finishOperation()
    }
  }, [beginOperation, finishOperation, setApiGatewayEnabled, showError, showSuccess, t])

  const restartApiGateway = useCallback(async () => {
    if (!beginOperation()) return
    try {
      const result = await window.api.apiGateway.restart()
      if (result.success) {
        await setApiGatewayEnabled(true)
        showSuccess('apiGateway.messages.restartSuccess')
      } else {
        showError(t('apiGateway.messages.restartError') + result.error)
      }
    } catch (error) {
      showError(t('apiGateway.messages.restartFailed') + (error as Error).message)
    } finally {
      finishOperation()
    }
  }, [beginOperation, finishOperation, setApiGatewayEnabled, showError, showSuccess, t])

  // Keep the UI toggle in sync when Main auto-starts the gateway (e.g. when
  // agents exist) while the persisted `enabled` flag is still false.
  useEffect(() => {
    if (apiGatewayRunning && !apiGatewayConfig.enabled) {
      void setApiGatewayEnabled(true).catch((error) => {
        showError(t('apiGateway.messages.operationFailed') + (error instanceof Error ? error.message : error))
      })
    }
  }, [apiGatewayRunning, apiGatewayConfig.enabled, setApiGatewayEnabled, showError, t])

  return {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayLoading,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    setApiGatewayEnabled,
    setApiGatewayConfig
  }
}
