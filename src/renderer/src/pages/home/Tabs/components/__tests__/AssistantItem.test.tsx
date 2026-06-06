import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  removeAllTopics: vi.fn(),
  setAssistantIconType: vi.fn(),
  updateAssistants: vi.fn()
}))

vi.mock('antd', () => ({
  Dropdown: ({ children }: { children: any }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/Avatar/AssistantAvatar', () => ({
  default: () => <div data-testid="assistant-avatar" />
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span />,
  DeleteIcon: () => <span />,
  EditIcon: () => <span />
}))

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/pages/settings/AssistantSettings', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { SWITCH_TOPIC_SIDEBAR: 'SWITCH_TOPIC_SIDEBAR' },
  EventEmitter: { emit: mocks.emit }
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  uuid: () => 'uuid-for-test'
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ removeAllTopics: mocks.removeAllTopics }),
  useAssistants: () => ({ assistants: [], updateAssistants: mocks.updateAssistants })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    clickAssistantToShowTopic: true,
    topicPosition: 'left',
    setAssistantIconType: mocks.setAssistantIconType
  })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useTags: () => ({ allTags: [] })
}))

vi.mock('@renderer/utils/queue', () => ({
  hasTopicPendingRequests: () => false
}))

vi.mock('../AssistantTagsPopup', () => ({
  default: { show: vi.fn() }
}))

import type { Assistant } from '@renderer/types'

import AssistantItem from '../AssistantItem'

describe('AssistantItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('switches assistants without opening the topic sidebar', () => {
    const assistant = {
      id: 'assistant-1',
      name: 'General Assistant',
      topics: [],
      type: 'assistant'
    } as unknown as Assistant
    const onSwitch = vi.fn()

    render(
      <AssistantItem
        assistant={assistant}
        isActive={false}
        sortBy="list"
        onSwitch={onSwitch}
        onDelete={vi.fn()}
        onCreateDefaultAssistant={vi.fn()}
        addPreset={vi.fn()}
        copyAssistant={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('General Assistant'))

    expect(onSwitch).toHaveBeenCalledWith(assistant)
    expect(mocks.emit).not.toHaveBeenCalled()
  })
})
