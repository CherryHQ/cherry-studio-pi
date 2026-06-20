import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigateApp: vi.fn()
}))

vi.mock('../../utils', () => ({
  navigateApp: mocks.navigateApp,
  normalizeAppRoute: (route: string) => {
    const raw = String(route || '/').trim()
    return raw.startsWith('/') ? raw : `/${raw}`
  },
  okResult: (summary: string, data?: unknown) => ({
    ok: true,
    summary,
    ...(data === undefined ? {} : { data })
  })
}))

import { createNavigationCapabilities } from '../navigation'

function capability(id: string) {
  const item = createNavigationCapabilities().find((capability) => capability.id === id)
  if (!item) throw new Error(`Missing capability: ${id}`)
  return item
}

describe('navigation app capabilities', () => {
  it('normalizes app routes before navigating and returning the result', async () => {
    const result = await capability('app.navigate').execute({ route: ' settings/data ' }, { source: 'agent' })

    expect(mocks.navigateApp).toHaveBeenCalledWith('/settings/data')
    expect(result).toEqual({
      ok: true,
      summary: '应用导航已完成',
      data: {
        route: '/settings/data'
      }
    })
  })

  it('rejects invalid routes instead of navigating to an implicit fallback', async () => {
    mocks.navigateApp.mockClear()

    await expect(capability('app.navigate').execute({}, { source: 'agent' })).rejects.toThrow('应用路由必须是字符串')
    await expect(capability('app.navigate').execute({ route: '   ' }, { source: 'agent' })).rejects.toThrow(
      '应用路由不能为空'
    )
    await expect(capability('app.navigate').execute({ route: ['settings/data'] }, { source: 'agent' })).rejects.toThrow(
      '应用路由必须是字符串'
    )

    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })

  it('stops before navigating when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('agent stopped navigation')

    await expect(
      capability('app.navigate').execute({ route: '/settings/data' }, { source: 'agent', signal: controller.signal })
    ).rejects.toThrow('agent stopped navigation')

    expect(mocks.navigateApp).not.toHaveBeenCalled()
  })

  it('does not return stale navigation success when cancellation happens during navigation', async () => {
    const controller = new AbortController()
    mocks.navigateApp.mockImplementationOnce(async () => {
      controller.abort('agent cancelled navigation')
    })

    await expect(
      capability('app.navigate').execute({ route: '/settings/data' }, { source: 'agent', signal: controller.signal })
    ).rejects.toThrow('agent cancelled navigation')
  })
})
