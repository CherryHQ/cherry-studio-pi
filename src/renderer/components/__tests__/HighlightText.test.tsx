import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HighlightText from '../HighlightText'

describe('HighlightText', () => {
  it('trims the keyword before highlighting', () => {
    render(<HighlightText text="Hello World" keyword="  hello  " />)

    expect(screen.getByText('Hello').tagName).toBe('MARK')
  })

  it('does not highlight whitespace-only keywords', () => {
    const { container } = render(<HighlightText text="Hello World" keyword="   " />)

    expect(container).toHaveTextContent('Hello World')
    expect(container.querySelector('mark')).toBeNull()
  })
})
