import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HistoryPage from '../HistoryPage'

vi.mock('@cherrystudio/ui', () => ({
  RowFlex: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('antd', () => ({
  Divider: (props: Record<string, unknown>) => <hr {...props} />,
  Input: ({
    prefix,
    suffix,
    value,
    onChange,
    onPressEnter,
    placeholder
  }: {
    prefix?: React.ReactNode
    suffix?: React.ReactNode
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    onPressEnter?: () => void
    placeholder?: string
  }) => (
    <label>
      {prefix}
      <input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onPressEnter?.()
          }
        }}
      />
      {suffix}
    </label>
  )
}))

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="chevron-left" />,
  CornerDownLeft: () => <span data-testid="corner-down-left" />,
  Search: () => <span data-testid="search-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../components/TopicsHistory', () => ({
  default: ({ onClick, style }: { onClick: (topic: null) => void; style?: React.CSSProperties }) => (
    <button type="button" style={style} onClick={() => onClick(null)}>
      missing topic
    </button>
  )
}))

vi.mock('../components/TopicMessages', () => ({
  default: () => null
}))

vi.mock('../components/SearchResults', () => ({
  default: () => null
}))

vi.mock('../components/SearchMessage', () => ({
  default: () => null
}))

describe('HistoryPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
  })

  it('does not crash when a missing topic is selected before toast is available', () => {
    render(<HistoryPage />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'missing topic' }))).not.toThrow()
  })
})
