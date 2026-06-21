import { beforeEach, describe, expect, it, vi } from 'vitest'

import { presentPaintingGenerationGuardFeedback } from '../../utils/presentPaintingGenerationGuardFeedback'
import { createPaintingGenerateError, presentPaintingGenerateError } from '../paintingGenerateError'

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/SettingsWindowService', () => ({
  openSettingsWindow: vi.fn()
}))

describe('painting generation feedback', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        error: vi.fn(),
        warning: vi.fn()
      }
    })
  })

  it('does not crash when a toast-presented generation error is shown before toast is available', () => {
    expect(() =>
      presentPaintingGenerateError(
        createPaintingGenerateError('PROMPT_REQUIRED', {
          presentation: 'toast',
          severity: 'warning'
        })
      )
    ).not.toThrow()
  })

  it('still presents modal generation errors when toast is unavailable', () => {
    presentPaintingGenerateError(createPaintingGenerateError('GENERATE_FAILED'))

    expect(window.modal.error).toHaveBeenCalledWith({
      content: 'paintings.generate_failed',
      centered: true
    })
  })

  it('does not crash when guard feedback needs toast before toast is available', () => {
    expect(() => presentPaintingGenerationGuardFeedback('model_missing')).not.toThrow()
    expect(() => presentPaintingGenerationGuardFeedback('model_unavailable')).not.toThrow()
    expect(() => presentPaintingGenerationGuardFeedback('catalog_error', new Error('catalog failed'))).not.toThrow()
  })
})
