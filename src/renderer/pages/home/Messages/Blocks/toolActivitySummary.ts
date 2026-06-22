import {
  formatToolActivityFileTask,
  formatToolActivityValueTask,
  formatToolActivityZhTask,
  isToolActivityZh,
  selectToolActivityText,
  TOOL_ACTIVITY_ACTION_RULES,
  TOOL_ACTIVITY_KNOWN_SUBJECTS,
  TOOL_ACTIVITY_SEARCH_REPLACEMENTS,
  TOOL_ACTIVITY_TEXT,
  TOOL_ACTIVITY_ZH_SUBJECTS,
  type ToolActivityLocalizedText
} from '@renderer/i18n/toolActivitySummary'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { getFileName } from '@renderer/utils/file'

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const argsOf = (block: ToolMessageBlock): Record<string, unknown> | undefined => {
  const args = block.metadata?.rawMcpToolResponse?.arguments ?? block.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  return args
}

const toolNameOf = (block: ToolMessageBlock) => {
  return block.metadata?.rawMcpToolResponse?.tool?.name || block.toolName || block.toolId || 'Tool'
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const stripPackageDecoration = (value: string) => {
  return value
    .replace(/^["'`]|["'`]$/g, '')
    .replace(
      /\s+(?:globally|locally|in workspace|in the workspace|via npm|using npm|with npm|related global npm packages?|related npm packages?|global npm packages?|npm packages?).*$/i,
      ''
    )
    .trim()
}

const formatSubject = (raw: string, language?: string) => {
  const cleaned = stripPackageDecoration(normalizeWhitespace(raw))
  const known = TOOL_ACTIVITY_KNOWN_SUBJECTS.find((item) => item.pattern.test(cleaned))
  if (known) return selectToolActivityText(language, known)
  if (isToolActivityZh(language)) {
    const subject = TOOL_ACTIVITY_ZH_SUBJECTS.find((item) => item.pattern.test(cleaned))
    if (subject) return subject.label
  }
  return cleaned
}

const normalizeZhSearchSubject = (raw: string, language?: string) => {
  const subject = TOOL_ACTIVITY_SEARCH_REPLACEMENTS.reduce(
    (value, replacement) => value.replace(replacement.pattern, replacement.replacement),
    formatSubject(raw, language)
  )
  return subject.replace(/\s+/g, '').trim()
}

const formatAction = (
  raw: string,
  language: string | undefined,
  zhVerb: string,
  enVerb: string,
  zhSuffix = '',
  enSuffix = ''
) => {
  const subject = formatSubject(raw, language)
  return selectToolActivityText(language, {
    zh: formatToolActivityZhTask(zhVerb, subject, zhSuffix),
    en: `${enVerb} ${subject}${enSuffix}`
  })
}

const basename = (filePath: string) => {
  return getFileName(filePath) || filePath
}

const summarizeEnglishDescription = (description: string, language?: string): string | undefined => {
  const value = normalizeWhitespace(description)

  if (/^install (?:project |package )?dependenc(?:y|ies)\b/i.test(value)) {
    return selectToolActivityText(language, TOOL_ACTIVITY_TEXT.projectDependencies)
  }

  const installMatch = value.match(
    /^install\s+(.+?)(?:\s+(?:globally|locally|in workspace|in the workspace|via|using|with)\b.*)?$/i
  )
  if (installMatch?.[1]) {
    const subject = formatSubject(installMatch[1], language)
    return selectToolActivityText(language, {
      zh: formatToolActivityZhTask(TOOL_ACTIVITY_TEXT.install.zh, subject),
      en: `${TOOL_ACTIVITY_TEXT.install.en} ${subject}`
    })
  }

  const fetchGuideMatch = value.match(/^fetch\s+(.+?)\s+(?:installation\s+)?guide(?:\s+with\s+.+)?$/i)
  if (fetchGuideMatch?.[1]) {
    const subject = formatSubject(fetchGuideMatch[1], language)
    const isInstallationGuide = /\binstallation\s+guide\b/i.test(value)
    if (isToolActivityZh(language)) {
      return formatToolActivityZhTask(
        TOOL_ACTIVITY_TEXT.fetch.zh,
        subject,
        isInstallationGuide ? TOOL_ACTIVITY_TEXT.installationGuide.zh : TOOL_ACTIVITY_TEXT.guide.zh
      )
    }
    return `${TOOL_ACTIVITY_TEXT.fetch.en} ${subject}${isInstallationGuide ? TOOL_ACTIVITY_TEXT.installationGuide.en : ''} guide`
  }

  const npmSearchMatch =
    value.match(/^search\s+npm\s+for\s+(.+?)\s+packages?$/i) ??
    value.match(/^search\s+for\s+(.+?)(?:\s+related)?\s+(?:global\s+)?npm\s+packages?$/i)
  if (npmSearchMatch?.[1])
    return formatAction(
      npmSearchMatch[1],
      language,
      TOOL_ACTIVITY_TEXT.find.zh,
      TOOL_ACTIVITY_TEXT.find.en,
      TOOL_ACTIVITY_TEXT.relatedNpmPackages.zh,
      TOOL_ACTIVITY_TEXT.relatedNpmPackages.en
    )

  const searchMatch = value.match(/^search(?:\s+for)?\s+(.+)$/i)
  if (searchMatch?.[1]) {
    const subject = isToolActivityZh(language)
      ? normalizeZhSearchSubject(searchMatch[1], language)
      : formatSubject(searchMatch[1], language)
    return selectToolActivityText(language, {
      zh: formatToolActivityZhTask(TOOL_ACTIVITY_TEXT.search.zh, subject),
      en: `${TOOL_ACTIVITY_TEXT.search.en} ${subject}`
    })
  }

  for (const [pattern, zhVerb, enVerb] of TOOL_ACTIVITY_ACTION_RULES) {
    const match = value.match(pattern)
    if (match?.[1]) return formatAction(match[1], language, zhVerb, enVerb)
  }

  return undefined
}

const summarizeChineseDescription = (description: string): string => {
  let summarized = normalizeWhitespace(description)
  const prefix = TOOL_ACTIVITY_TEXT.chineseDescriptionPrefixes.find((prefix) => summarized.startsWith(prefix))
  if (prefix) {
    summarized = summarized.slice(prefix.length)
  }

  return summarized.replace(/。.*$/, '').trim()
}

const summarizeCommand = (command: string, language?: string): string | undefined => {
  const value = normalizeWhitespace(command)

  const globalInstallMatch = value.match(
    /\b(?:npm|pnpm)\s+(?:install|i|add)\s+(?:[^\n;&|]*\s)?(?:-g|--global)\s+([^\s;&|]+)/i
  )
  if (globalInstallMatch?.[1]) {
    const subject = formatSubject(globalInstallMatch[1], language)
    return selectToolActivityText(language, {
      zh: formatToolActivityZhTask(TOOL_ACTIVITY_TEXT.install.zh, subject),
      en: `${TOOL_ACTIVITY_TEXT.install.en} ${subject}`
    })
  }

  const localInstallMatch = value.match(/\b(?:npm|pnpm)\s+(?:install|i|add)\s+([^\s;&|]+)/i)
  if (localInstallMatch?.[1]) {
    const subject = formatSubject(localInstallMatch[1], language)
    return selectToolActivityText(language, {
      zh: formatToolActivityZhTask(TOOL_ACTIVITY_TEXT.install.zh, subject),
      en: `${TOOL_ACTIVITY_TEXT.install.en} ${subject}`
    })
  }

  if (/\b(?:npm|pnpm|yarn)\s+(?:install|i)\b/i.test(value)) {
    return selectToolActivityText(language, TOOL_ACTIVITY_TEXT.projectDependencies)
  }

  const npmSearchMatch = value.match(/\b(?:npm|pnpm)\s+search\s+([^\s;&|]+)/i)
  if (npmSearchMatch?.[1]) {
    const subject = formatSubject(npmSearchMatch[1], language)
    return selectToolActivityText(language, {
      zh: formatToolActivityZhTask(TOOL_ACTIVITY_TEXT.find.zh, subject, TOOL_ACTIVITY_TEXT.relatedNpmPackages.zh),
      en: `${TOOL_ACTIVITY_TEXT.search.en} ${subject} ${TOOL_ACTIVITY_TEXT.npmPackages.en}`
    })
  }

  if (/\b(?:npm|pnpm)\s+search\b/i.test(value)) {
    return selectToolActivityText(language, {
      zh: formatToolActivityZhTask(TOOL_ACTIVITY_TEXT.find.zh, TOOL_ACTIVITY_TEXT.npmPackages.zh),
      en: `${TOOL_ACTIVITY_TEXT.search.en} ${TOOL_ACTIVITY_TEXT.npmPackages.en}`
    })
  }

  if (/\b(?:curl|wget)\b/i.test(value)) {
    return selectToolActivityText(language, TOOL_ACTIVITY_TEXT.onlineResource)
  }

  return undefined
}

const fileTask = (
  language: string | undefined,
  filePath: string | undefined,
  verb: ToolActivityLocalizedText,
  fallbackSubject: ToolActivityLocalizedText
) => {
  const name = filePath ? basename(filePath) : undefined
  return formatToolActivityFileTask(language, name, verb, fallbackSubject)
}

const valueTask = (
  language: string | undefined,
  value: string | undefined,
  verb: ToolActivityLocalizedText,
  fallbackSubject: ToolActivityLocalizedText
) => formatToolActivityValueTask(language, value, verb, fallbackSubject)

export const getToolActivitySummary = (block: ToolMessageBlock, language?: string): string => {
  const args = argsOf(block)
  const description = text(args?.description)

  if (description) {
    if (/[\u4e00-\u9fa5]/.test(description)) {
      const summarized = summarizeChineseDescription(description)
      if (summarized) return summarized
    }

    const summarized = summarizeEnglishDescription(description, language)
    if (summarized) return summarized

    return description
  }

  const commandSummary = text(args?.command) ? summarizeCommand(text(args?.command)!, language) : undefined
  if (commandSummary) return commandSummary

  const toolName = toolNameOf(block)
  const filePath = text(args?.file_path ?? args?.path)
  const pattern = text(args?.pattern)
  const query = text(args?.query)

  switch (toolName) {
    case 'Read':
      return fileTask(language, filePath, TOOL_ACTIVITY_TEXT.read, TOOL_ACTIVITY_TEXT.file)
    case 'Write':
      return fileTask(language, filePath, TOOL_ACTIVITY_TEXT.write, TOOL_ACTIVITY_TEXT.file)
    case 'Edit':
    case 'MultiEdit':
      return fileTask(language, filePath, TOOL_ACTIVITY_TEXT.update, TOOL_ACTIVITY_TEXT.file)
    case 'Glob':
      return valueTask(language, pattern, TOOL_ACTIVITY_TEXT.find, TOOL_ACTIVITY_TEXT.files)
    case 'Grep':
      return valueTask(language, pattern, TOOL_ACTIVITY_TEXT.search, TOOL_ACTIVITY_TEXT.content)
    case 'WebSearch':
      return valueTask(language, query, TOOL_ACTIVITY_TEXT.search, TOOL_ACTIVITY_TEXT.web)
    case 'WebFetch':
      return selectToolActivityText(language, TOOL_ACTIVITY_TEXT.onlineResource)
    default:
      if (toolName.startsWith('mcp__')) return selectToolActivityText(language, TOOL_ACTIVITY_TEXT.mcpTool)
      return selectToolActivityText(language, TOOL_ACTIVITY_TEXT.processTask)
  }
}
