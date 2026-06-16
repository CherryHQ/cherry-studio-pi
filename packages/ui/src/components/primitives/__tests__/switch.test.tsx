// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Switch } from '../switch'

afterEach(() => {
  cleanup()
})

describe('Switch', () => {
  it('toggles aria-checked when clicked', async () => {
    const user = userEvent.setup()
    render(<Switch />)

    const root = screen.getByRole('switch')

    expect(root).toHaveAttribute('aria-checked', 'false')
    await user.click(root)
    expect(root).toHaveAttribute('aria-checked', 'true')
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    render(<Switch disabled />)

    const root = screen.getByRole('switch')

    expect(root).toHaveAttribute('aria-checked', 'false')
    await user.click(root)
    expect(root).toHaveAttribute('aria-checked', 'false')
  })

  it('calls onCheckedChange with the next checked state', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('switch'))

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('does not call onCheckedChange when disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch disabled onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('switch'))

    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('does not leak onCheckedChange to the DOM', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      render(<Switch onCheckedChange={vi.fn()} />)

      expect(consoleError.mock.calls.some((args) => args.some((arg) => String(arg).includes('onCheckedChange')))).toBe(
        false
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})
