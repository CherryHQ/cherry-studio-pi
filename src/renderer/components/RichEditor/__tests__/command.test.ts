import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  autoUpdate: vi.fn(),
  computePosition: vi.fn(),
  cleanupFns: [] as Array<ReturnType<typeof vi.fn>>,
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  popoverKeyDown: vi.fn(),
  posToDOMRect: vi.fn(),
  rendererInstances: [] as Array<{
    element: HTMLElement
    ref: { onKeyDown: ReturnType<typeof vi.fn> }
    updateProps: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError,
      warn: mocks.loggerWarn
    })
  }
}))

vi.mock('@floating-ui/dom', () => ({
  autoUpdate: mocks.autoUpdate,
  computePosition: mocks.computePosition,
  flip: vi.fn(() => ({ name: 'flip' })),
  offset: vi.fn(() => ({ name: 'offset' })),
  shift: vi.fn(() => ({ name: 'shift' })),
  size: vi.fn(() => ({ name: 'size' }))
}))

vi.mock('@tiptap/react', () => ({
  posToDOMRect: mocks.posToDOMRect,
  ReactRenderer: class MockReactRenderer {
    element = document.createElement('div')
    ref = { onKeyDown: mocks.popoverKeyDown }
    updateProps = vi.fn()
    destroy = vi.fn()

    constructor() {
      mocks.rendererInstances.push(this)
    }
  }
}))

vi.mock('../CommandListPopover', () => ({
  default: vi.fn()
}))

import { commandSuggestion } from '../command'

function createSuggestionProps() {
  return {
    items: [],
    clientRect: () => new DOMRect(0, 0, 10, 10),
    editor: {
      view: {},
      state: {
        selection: {
          from: 1,
          to: 1
        }
      }
    }
  }
}

function createKeyDownProps(key: string) {
  const tr = { insertText: vi.fn() }
  return {
    event: {
      key,
      shiftKey: false,
      preventDefault: vi.fn()
    },
    view: {
      state: { tr },
      dispatch: vi.fn()
    }
  }
}

describe('commandSuggestion renderer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.cleanupFns.length = 0
    mocks.rendererInstances.length = 0
    mocks.autoUpdate.mockImplementation(() => {
      const cleanup = vi.fn()
      mocks.cleanupFns.push(cleanup)
      return cleanup
    })
    mocks.computePosition.mockResolvedValue({
      x: 12,
      y: 24,
      strategy: 'fixed',
      placement: 'bottom-start'
    })
    mocks.posToDOMRect.mockReturnValue(new DOMRect(0, 0, 10, 10))
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('ignores lifecycle events safely if start props are invalid', () => {
    const lifecycle = commandSuggestion.render?.() as any

    expect(() => lifecycle.onStart({ items: null, clientRect: null })).not.toThrow()
    expect(() => lifecycle.onUpdate(createSuggestionProps())).not.toThrow()
    expect(lifecycle.onKeyDown(createKeyDownProps('Escape'))).toBe(false)
    expect(() => lifecycle.onExit()).not.toThrow()

    expect(mocks.loggerWarn).toHaveBeenCalledWith('Invalid props in command suggestion onStart')
    expect(mocks.rendererInstances).toHaveLength(0)
  })

  it('clears pending position updates when the popover closes', () => {
    const lifecycle = commandSuggestion.render?.() as any
    const props = createSuggestionProps()

    lifecycle.onStart(props)
    const renderer = mocks.rendererInstances[0]
    expect(renderer).toBeDefined()
    expect(document.body.contains(renderer.element)).toBe(true)
    expect(mocks.computePosition).toHaveBeenCalledTimes(1)

    lifecycle.onUpdate(props)
    lifecycle.onExit()

    expect(mocks.cleanupFns[0]).toHaveBeenCalledTimes(1)
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
    expect(document.body.contains(renderer.element)).toBe(false)

    vi.runOnlyPendingTimers()
    lifecycle.onExit()

    expect(mocks.computePosition).toHaveBeenCalledTimes(1)
    expect(mocks.cleanupFns[0]).toHaveBeenCalledTimes(1)
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
  })
})
