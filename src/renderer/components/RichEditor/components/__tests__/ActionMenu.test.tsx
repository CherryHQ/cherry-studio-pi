import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActionMenu } from '../ActionMenu'

function renderActionMenu(onClose = vi.fn()) {
  const itemClick = vi.fn()
  const view = render(
    <ActionMenu
      show
      position={{ x: 12, y: 24 }}
      items={[
        {
          key: 'delete',
          label: 'Delete row',
          onClick: itemClick
        }
      ]}
      onClose={onClose}
    />
  )

  return {
    ...view,
    itemClick,
    onClose
  }
}

function createMouseDown(target: EventTarget) {
  const event = new MouseEvent('mousedown', { bubbles: true })
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target
  })
  return event
}

describe('ActionMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not close when clicking inside the menu', () => {
    const { onClose } = renderActionMenu()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Delete row' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when clicking outside the menu', () => {
    const { onClose } = renderActionMenu()
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    fireEvent.mouseDown(outside)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('treats non-node mousedown targets as outside the menu', () => {
    const { onClose } = renderActionMenu()
    const event = createMouseDown(window)

    expect(() => document.dispatchEvent(event)).not.toThrow()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
