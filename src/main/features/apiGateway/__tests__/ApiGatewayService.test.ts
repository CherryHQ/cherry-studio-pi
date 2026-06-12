import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises `ApiGatewayService`'s reconcile-after-settle convergence: a toggle that
 * lands during an in-flight activation must be honoured (no queue, no dropped opposing
 * toggle), and a persistently failing transition must not spin the loop.
 *
 * The inner `ApiGateway` server is mocked so activation timing is controllable; the
 * preference-change handler is captured so the toggle can be driven directly.
 */

const { mockLogger, mockStart, mockStop, captured } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  captured: {
    prefHandler: undefined as ((enabled: boolean) => void) | undefined,
    gatewayConfig: { enabled: false, host: '127.0.0.1', port: 23333, apiKey: 'existing-key' }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('../server', () => ({
  ApiGateway: vi.fn(() => ({ start: mockStart, stop: mockStop, isRunning: () => true }))
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      subscribeChange: vi.fn((_key: string, cb: (enabled: boolean) => void) => {
        captured.prefHandler = cb
        return () => {}
      }),
      get: vi.fn((key: string) => (key.endsWith('api_key') ? 'existing-key' : false)),
      getMultiple: vi.fn(() => captured.gatewayConfig),
      set: vi.fn(async () => {})
    },
    CacheService: { setShared: vi.fn() }
  })
})

import { ApiGatewayService } from '../ApiGatewayService'

let startResolvers: Array<() => void>
let rejectStart: boolean

beforeEach(() => {
  BaseService.resetInstances()
  captured.prefHandler = undefined
  captured.gatewayConfig = { enabled: false, host: '127.0.0.1', port: 23333, apiKey: 'existing-key' }
  startResolvers = []
  rejectStart = false
  vi.clearAllMocks()
  mockStart.mockReset()
  mockStop.mockReset()
  mockStart.mockImplementation(() =>
    rejectStart
      ? Promise.reject(new Error('port in use'))
      : new Promise<void>((resolve) => startResolvers.push(resolve))
  )
  mockStop.mockResolvedValue(undefined)
})

describe('ApiGatewayService reconcile', () => {
  it('does not auto-start on boot unless the API gateway preference is enabled', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    expect(service.isActivated).toBe(false)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('auto-starts on boot when the API gateway preference is enabled', async () => {
    captured.gatewayConfig = { enabled: true, host: '127.0.0.1', port: 23333, apiKey: 'existing-key' }
    const service = new ApiGatewayService()

    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    expect(service.isActivated).toBe(true)
  })

  it('honors an opposing toggle that lands during an in-flight activation (no dropped toggle)', async () => {
    const service = new ApiGatewayService()
    await service._doInit() // Ready; desiredEnabled=false; reconcile is a no-op.
    expect(service.isActivated).toBe(false)
    expect(captured.prefHandler).toBeDefined()

    // Enable → reconcile starts activating; the inner start() stays pending.
    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false) // still mid-activation

    // Opposing disable lands mid-activation. A queue/short-circuit would drop it;
    // reconcile re-reads the desired state after the activation settles.
    captured.prefHandler!(false)

    // Complete the activation — the loop must now deactivate to converge to `false`.
    startResolvers[0]()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
  })

  it('converges to running when the final desired state is enabled', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('does not retry a failed activation for a stable desired state (no spin loop)', async () => {
    rejectStart = true
    const service = new ApiGatewayService()
    await service._doInit()

    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    // Give the loop a chance to (wrongly) retry the same failing target.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(service.isActivated).toBe(false)
  })

  it('logs cleanup failures without masking the original activation error', async () => {
    rejectStart = true
    mockStop.mockRejectedValueOnce(new Error('cleanup failed'))
    const service = new ApiGatewayService()
    await service._doInit()

    await expect(service.onActivate()).rejects.toThrow('port in use')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to stop partially activated API gateway',
      expect.objectContaining({ message: 'cleanup failed' })
    )
  })

  it('converges when a pref change opposes an in-flight direct IPC start (single owner)', async () => {
    // The residual race: a direct IPC start() in flight + an opposing pref change.
    // With start() routed through the same queue, the pref change can't be dropped.
    const service = new ApiGatewayService()
    await service._doInit()

    // Attach the settle handler synchronously so the in-flight rejection (start() ends
    // up !isActivated because desired flipped) is never an unhandled rejection.
    const startSettled = service.start().then(
      () => 'resolved',
      () => 'rejected'
    )
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))

    // Opposing disable lands while the IPC activation is still in flight.
    captured.prefHandler!(false)

    // Complete the activation; the running reconcile must then deactivate to converge.
    startResolvers[0]()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    await startSettled

    expect(service.isActivated).toBe(false) // converged to desiredEnabled === false
  })
})
