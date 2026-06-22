import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PaintingModelSelector from '../PaintingModelSelector'

const { useModelsMock, useProvidersMock } = vi.hoisted(() => ({
  useModelsMock: vi.fn(),
  useProvidersMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
  AvatarFallback: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
  Button: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  CustomTag: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  )
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveIcon: () => undefined
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => <div>{trigger}</div>
}))

vi.mock('@renderer/components/Selector/model/utils', () => ({
  getProviderDisplayName: (provider: Provider) => provider.name
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => useModelsMock()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => useProvidersMock()
}))

function makeImageModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-image-1',
    providerId: 'openai',
    name: 'GPT Image Friendly Name',
    capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
    supportsStreaming: false,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('PaintingModelSelector', () => {
  beforeEach(() => {
    useModelsMock.mockReset()
    useProvidersMock.mockReset()
    useProvidersMock.mockReturnValue({
      providers: [{ id: 'openai', name: 'OpenAI' }],
      isLoading: false
    })
  })

  it('shows the friendly model name when the selected row has no apiModelId', () => {
    useModelsMock.mockReturnValue({
      models: [makeImageModel({ apiModelId: undefined })],
      isLoading: false
    })

    render(
      <PaintingModelSelector
        painting={{
          id: 'painting-1',
          providerId: 'openai',
          mode: 'generate',
          model: 'gpt-image-1',
          prompt: '',
          files: []
        }}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText(/GPT Image Friendly Name/)).toBeInTheDocument()
  })
})
