import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingHelpLink, SettingTitleExternalLink } from '../SettingsPrimitives'

describe('SettingsPrimitives links', () => {
  it('adds noopener noreferrer to setting help links opened in a new tab', () => {
    render(
      <SettingHelpLink href="https://example.com/docs" target="_blank">
        Docs
      </SettingHelpLink>
    )

    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps explicit rel values on setting help links', () => {
    render(
      <SettingHelpLink href="https://example.com/docs" target="_blank" rel="nofollow">
        Docs
      </SettingHelpLink>
    )

    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('rel', 'nofollow')
  })

  it('uses safe new-tab defaults for title external links', () => {
    render(<SettingTitleExternalLink href="https://example.com">Open</SettingTitleExternalLink>)

    const link = screen.getByRole('link', { name: 'Open' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
