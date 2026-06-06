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
      summary: 'Application navigated',
      data: {
        route: '/settings/data'
      }
    })
  })
})
