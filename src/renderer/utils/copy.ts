import type { Message, Topic } from '@renderer/types'
import i18next from 'i18next'

import { formatErrorMessageWithPrefix } from './error'
import { messageToPlainText, topicToMarkdown, topicToPlainText } from './export'

const copyTextWithFeedback = async (getText: () => Promise<string> | string) => {
  try {
    const text = await getText()
    await navigator.clipboard.writeText(text)
    window.toast?.success(i18next.t('message.copy.success'))
  } catch (error) {
    window.toast?.error(formatErrorMessageWithPrefix(error, i18next.t('common.copy_failed')))
  }
}

export const copyTopicAsMarkdown = async (topic: Topic) => {
  await copyTextWithFeedback(() => topicToMarkdown(topic))
}

export const copyTopicAsPlainText = async (topic: Topic) => {
  await copyTextWithFeedback(() => topicToPlainText(topic))
}

export const copyMessageAsPlainText = async (message: Message) => {
  await copyTextWithFeedback(() => messageToPlainText(message))
}
