import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  npxFinder: vi.fn(),
  shikiMarkdownIt: vi.fn()
}))

vi.mock('npx-scope-finder', () => ({
  npxFinder: mocks.npxFinder
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    shikiMarkdownIt: mocks.shikiMarkdownIt
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.loading': 'Loading',
        'settings.mcp.noDescriptionAvailable': 'No description'
      }
      return map[key] ?? key
    }
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Spinner: ({ text }: { text: string }) => <div>{text}</div>
}))

describe('McpDescription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shikiMarkdownIt.mockImplementation(async (value: string) => `<p>${value}</p>`)
  })

  it('waits for README markdown rendering before hiding loading state', async () => {
    mocks.npxFinder.mockResolvedValue([{ original: { readme: 'Rendered README' } }])
    const { default: McpDescription } = await import('../McpDescription')

    render(<McpDescription searchKey="@scope/server" />)

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(await screen.findByText('Rendered README')).toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  it('shows a fallback description when package lookup fails', async () => {
    mocks.npxFinder.mockRejectedValue(new Error('network down'))
    const { default: McpDescription } = await import('../McpDescription')

    render(<McpDescription searchKey="@scope/server" />)

    expect(await screen.findByText('No description')).toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })
})
