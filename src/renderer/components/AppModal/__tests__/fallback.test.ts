import { describe, expect, it, vi } from 'vitest'

import type { AppModalApi } from '..'
import { ensureWindowModalFallback, fallbackModal, resetWindowModalFallbackIfCurrent } from '../fallback'

function createModalStub(): AppModalApi {
  const result = Object.assign(Promise.resolve(false), {
    destroy: vi.fn(),
    update: vi.fn()
  })

  return {
    confirm: vi.fn(() => result),
    error: vi.fn(() => result),
    info: vi.fn(() => result),
    success: vi.fn(() => result),
    warning: vi.fn(() => result),
    warn: vi.fn(() => result),
    destroyAll: vi.fn()
  }
}

describe('AppModal fallback', () => {
  it('installs a safe modal bridge when none exists', async () => {
    const target: { modal?: AppModalApi } = {}

    ensureWindowModalFallback(target)

    expect(target.modal).toBe(fallbackModal)
    if (!target.modal) throw new Error('fallback modal was not installed')
    await expect(target.modal.confirm({ title: 'confirm' })).resolves.toBe(false)
    expect(() => target.modal?.destroyAll()).not.toThrow()
  })

  it('does not overwrite an already registered modal bridge', () => {
    const existing = createModalStub()
    const target = { modal: existing }

    ensureWindowModalFallback(target)

    expect(target.modal).toBe(existing)
  })

  it('restores fallback only when the registered modal still belongs to the unmounting provider', () => {
    const owned = createModalStub()
    const newer = createModalStub()
    const target = { modal: owned }

    resetWindowModalFallbackIfCurrent(owned, target)
    expect(target.modal).toBe(fallbackModal)

    target.modal = newer
    resetWindowModalFallbackIfCurrent(owned, target)
    expect(target.modal).toBe(newer)
  })
})
