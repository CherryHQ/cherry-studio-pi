import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SelectionBox from '../SelectionBox'

function setupSelectionBox() {
  const scrollContainer = document.createElement('div')
  document.body.appendChild(scrollContainer)

  const addEventListener = vi.spyOn(scrollContainer, 'addEventListener')
  const removeEventListener = vi.spyOn(scrollContainer, 'removeEventListener')
  const handleSelectMessage = vi.fn()

  const view = render(
    <SelectionBox
      isMultiSelectMode
      scrollContainerRef={{ current: scrollContainer }}
      messageElements={new Map()}
      handleSelectMessage={handleSelectMessage}
    />
  )

  const mouseDown = addEventListener.mock.calls.find(([type]) => type === 'mousedown')?.[1] as
    | ((event: MouseEvent) => void)
    | undefined

  if (!mouseDown) {
    throw new Error('SelectionBox did not register a mousedown listener')
  }

  return {
    mouseDown,
    scrollContainer,
    removeEventListener,
    unmount: view.unmount
  }
}

function createMouseDown(target: EventTarget) {
  const event = new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 })
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target
  })
  const preventDefault = vi.spyOn(event, 'preventDefault')

  return { event, preventDefault }
}

describe('SelectionBox', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('ignores mousedown events whose target cannot resolve to an element', () => {
    const { mouseDown } = setupSelectionBox()
    const { event, preventDefault } = createMouseDown(window)

    expect(() => mouseDown(event)).not.toThrow()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('uses parent elements for text-node targets before checking excluded areas', () => {
    const { mouseDown } = setupSelectionBox()
    const footer = document.createElement('div')
    footer.className = 'MessageFooter'
    const footerText = document.createTextNode('footer')
    footer.appendChild(footerText)

    const { event, preventDefault } = createMouseDown(footerText)

    expect(() => mouseDown(event)).not.toThrow()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('still starts selection for normal text-node targets', () => {
    const { mouseDown } = setupSelectionBox()
    const content = document.createElement('div')
    const text = document.createTextNode('message body')
    content.appendChild(text)
    const { event, preventDefault } = createMouseDown(text)

    act(() => {
      mouseDown(event)
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
