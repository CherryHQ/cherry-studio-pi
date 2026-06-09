import type * as CherryStudioUi from '@cherrystudio/ui'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentFormState } from '../descriptor'
import BasicSection from '../sections/BasicSection'

const { modelFilters } = vi.hoisted(() => ({
  modelFilters: [] as Array<((model: any) => boolean) | undefined>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const models = [
  {
    id: 'anthropic::claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
  },
  {
    id: 'anthropic::claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
  },
  {
    id: 'anthropic::claude-opus-4-5',
    name: 'Claude Opus 4.5',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
  }
]

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  const React = await import('react')
  const PopoverContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null)

  const Popover = ({
    open,
    onOpenChange,
    children
  }: {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(Boolean(open))
    const resolvedOpen = open ?? uncontrolledOpen

    const setOpen = (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    }

    return <PopoverContext value={{ open: resolvedOpen, setOpen }}>{children}</PopoverContext>
  }

  const PopoverTrigger = ({
    children
  }: {
    asChild?: boolean
    children: React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>
  }) => {
    const context = React.use(PopoverContext)
    if (!context) return children

    // eslint-disable-next-line @eslint-react/no-clone-element -- Test double mirrors PopoverTrigger asChild semantics.
    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event)
        context.setOpen(!context.open)
      }
    })
  }

  const PopoverContent = ({ children }: { children: React.ReactNode }) => {
    const context = React.use(PopoverContext)
    if (!context?.open) return null
    return <div>{children}</div>
  }

  return {
    ...actual,
    Popover,
    PopoverTrigger,
    PopoverContent
  }
})

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models, isLoading: false })
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({
    trigger,
    filter,
    onSelect
  }: {
    trigger: ReactNode
    filter?: (model: any) => boolean
    onSelect: (modelId: string | undefined) => void
  }) => {
    modelFilters.push(filter)
    return (
      <div>
        <div data-testid="model-selector-trigger">{trigger}</div>
        <button type="button" onClick={() => onSelect('anthropic::claude-sonnet-4-5')}>
          select main
        </button>
        <button type="button" onClick={() => onSelect('anthropic::claude-haiku-4-5')}>
          select plan
        </button>
        <button type="button" onClick={() => onSelect('anthropic::claude-opus-4-5')}>
          select small
        </button>
        <button type="button" onClick={() => onSelect(undefined)}>
          clear via selector
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/EmojiPicker', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🧠')}>
      pick emoji
    </button>
  )
}))

function createForm(overrides: Partial<AgentFormState> = {}): AgentFormState {
  return {
    type: 'pi',
    name: 'Agent',
    description: '',
    model: '',
    planModel: '',
    smallModel: '',
    instructions: '',
    mcps: [],
    allowedTools: [],
    avatar: '',
    permissionMode: '',
    maxTurns: 0,
    envVarsText: '',
    soulEnabled: false,
    heartbeatEnabled: false,
    heartbeatInterval: 0,
    ...overrides
  }
}

describe('BasicSection agent model selectors', () => {
  beforeEach(() => {
    modelFilters.length = 0
  })

  function createModel(overrides: Record<string, unknown> = {}) {
    return {
      id: 'openai::gpt-4.1',
      name: 'GPT 4.1',
      capabilities: [],
      endpointTypes: ['openai_responses'],
      ...overrides
    }
  }

  it('writes selected UniqueModelIds directly into each agent model field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<BasicSection form={createForm()} onChange={onChange} />)

    await user.click(screen.getAllByRole('button', { name: 'select main' })[0])
    await user.click(screen.getAllByRole('button', { name: 'select plan' })[1])
    await user.click(screen.getAllByRole('button', { name: 'select small' })[2])

    expect(onChange).toHaveBeenCalledWith({ model: 'anthropic::claude-sonnet-4-5' })
    expect(onChange).toHaveBeenCalledWith({ planModel: 'anthropic::claude-haiku-4-5' })
    expect(onChange).toHaveBeenCalledWith({ smallModel: 'anthropic::claude-opus-4-5' })
  })

  it('allows non-Anthropic chat models for Pi agents while excluding non-chat model capabilities', () => {
    render(<BasicSection form={createForm({ type: 'pi' })} onChange={vi.fn()} />)

    const filter = modelFilters[0]
    expect(filter?.(createModel())).toBe(true)
    expect(filter?.(createModel({ capabilities: [MODEL_CAPABILITY.EMBEDDING] }))).toBe(false)
    expect(filter?.(createModel({ capabilities: [MODEL_CAPABILITY.RERANK] }))).toBe(false)
    expect(filter?.(createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] }))).toBe(false)
  })

  it('keeps the Anthropic endpoint restriction only for Claude SDK enhanced agents', () => {
    render(<BasicSection form={createForm({ type: 'claude-code' })} onChange={vi.fn()} />)

    const filter = modelFilters[0]
    expect(filter?.(createModel())).toBe(false)
    expect(filter?.(createModel({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] }))).toBe(true)
    expect(screen.getByText('agent.add.model.tooltip')).toBeInTheDocument()
  })

  it('clears optional plan and small model fields to empty strings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <BasicSection
        form={createForm({
          model: 'anthropic::claude-sonnet-4-5',
          planModel: 'anthropic::claude-haiku-4-5',
          smallModel: 'anthropic::claude-opus-4-5'
        })}
        onChange={onChange}
      />
    )

    await user.click(
      screen.getByRole('button', {
        name: 'library.config.agent.field.plan_model.label library.config.basic.model_clear'
      })
    )
    await user.click(
      screen.getByRole('button', {
        name: 'library.config.agent.field.small_model.label library.config.basic.model_clear'
      })
    )

    expect(onChange).toHaveBeenCalledWith({ planModel: '' })
    expect(onChange).toHaveBeenCalledWith({ smallModel: '' })
  })
})
