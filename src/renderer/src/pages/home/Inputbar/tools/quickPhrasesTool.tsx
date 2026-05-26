import QuickPhrasesButton from '@renderer/pages/home/Inputbar/tools/components/QuickPhrasesButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

const quickPhrasesTool = defineTool({
  key: 'quick_phrases',
  label: (t) => t('settings.quickPhrase.title'),

  visibleInScopes: [TopicType.Chat, TopicType.Session, 'mini-window'],

  dependencies: {
    actions: ['onTextChange', 'resizeTextArea'] as const
  },

  render: (context) => {
    const { assistant, actions, quickPanel, scope } = context

    return scope === TopicType.Session ? (
      <QuickPhrasesButton
        quickPanel={quickPanel}
        setInputValue={actions.onTextChange}
        resizeTextArea={actions.resizeTextArea}
        assistant={assistant}
        allowAssistantPhrases={false}
      />
    ) : (
      <QuickPhrasesButton
        quickPanel={quickPanel}
        setInputValue={actions.onTextChange}
        resizeTextArea={actions.resizeTextArea}
        assistantId={assistant.id}
      />
    )
  }
})

registerTool(quickPhrasesTool)

export default quickPhrasesTool
