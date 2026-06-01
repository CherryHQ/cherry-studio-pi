export type ToolActivityLocalizedText = {
  zh: string
  en: string
}

export const TOOL_ACTIVITY_KNOWN_SUBJECTS: Array<{ pattern: RegExp; zh: string; en: string }> = [
  { pattern: /(?:@?feishu|lark)[-\s_]*cli/i, zh: '飞书 CLI', en: 'Feishu CLI' },
  { pattern: /@feishu/i, zh: '飞书', en: 'Feishu' },
  { pattern: /\b(?:feishu|lark)\b/i, zh: '飞书', en: 'Feishu' }
]

export const TOOL_ACTIVITY_ZH_SUBJECTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^(?:project|package)\s+dependenc(?:y|ies)$/i, label: '项目依赖' },
  { pattern: /^target\s+skill\s+location$/i, label: '技能位置' },
  { pattern: /^other\s+package\s+managers?$/i, label: '包管理器' },
  { pattern: /^package\s+managers?$/i, label: '包管理器' },
  { pattern: /^repositories$/i, label: '代码仓库' },
  { pattern: /^repository$/i, label: '代码仓库' },
  { pattern: /^tool$/i, label: '工具' },
  { pattern: /^tools$/i, label: '工具' },
  { pattern: /^workspace$/i, label: '工作区' },
  { pattern: /^environment$/i, label: '运行环境' }
]

export const TOOL_ACTIVITY_ACTION_RULES: Array<[RegExp, string, string]> = [
  [/^fetch\s+(.+)$/i, '获取', 'Fetch'],
  [/^read\s+(.+)$/i, '读取', 'Read'],
  [/^list\s+(.+)$/i, '查看', 'List'],
  [/^check\s+(.+)$/i, '检查', 'Check'],
  [/^(?:inspect|probe|verify|test|look\s+for|locate)\s+(.+)$/i, '检查', 'Check'],
  [/^register\s+(.+?)(?:\s+(?:globally|locally|after)\b.*)?$/i, '注册', 'Register'],
  [/^run\s+(.+)$/i, '运行', 'Run']
]

export const TOOL_ACTIVITY_SEARCH_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\brelated\b/gi, replacement: '相关' },
  { pattern: /\bglobal\b/gi, replacement: '' },
  { pattern: /\bnpm\b/gi, replacement: 'npm' },
  { pattern: /\bpackages?\b/gi, replacement: '包' }
]

export const TOOL_ACTIVITY_TEXT = {
  install: { zh: '安装', en: 'Install' },
  fetch: { zh: '获取', en: 'Fetch' },
  find: { zh: '查找', en: 'Find' },
  search: { zh: '搜索', en: 'Search' },
  read: { zh: '读取', en: 'Read' },
  write: { zh: '写入', en: 'Write' },
  update: { zh: '更新', en: 'Update' },
  projectDependencies: { zh: '安装项目依赖', en: 'Install project dependencies' },
  installationGuide: { zh: '安装指南', en: ' installation' },
  guide: { zh: '指南', en: '' },
  relatedNpmPackages: { zh: '相关 npm 包', en: ' npm packages' },
  npmPackages: { zh: 'npm 包', en: 'npm packages' },
  onlineResource: { zh: '获取在线资料', en: 'Fetch online resource' },
  file: { zh: '文件', en: 'file' },
  files: { zh: '文件', en: 'files' },
  content: { zh: '内容', en: 'content' },
  web: { zh: '网络', en: 'web' },
  mcpTool: { zh: '调用 MCP 工具', en: 'Call MCP tool' },
  processTask: { zh: '处理任务', en: 'Process task' },
  chineseDescriptionPrefixes: ['让我先', '让我', '正在']
} as const

export const isToolActivityZh = (language?: string) => language?.toLowerCase().startsWith('zh')

export const selectToolActivityText = (language: string | undefined, text: ToolActivityLocalizedText) =>
  isToolActivityZh(language) ? text.zh : text.en

export const formatToolActivityZhTask = (verb: string, subject: string, suffix = '') => {
  const spacer = suffix && /[A-Za-z0-9]$/.test(subject) ? ' ' : ''
  return `${verb}${subject}${spacer}${suffix}`
}

export const formatToolActivityFileTask = (
  language: string | undefined,
  name: string | undefined,
  verb: ToolActivityLocalizedText,
  fallbackSubject: ToolActivityLocalizedText
) => {
  if (name) {
    return selectToolActivityText(language, {
      zh: `${verb.zh}${name}`,
      en: `${verb.en} ${name}`
    })
  }

  return selectToolActivityText(language, {
    zh: `${verb.zh}${fallbackSubject.zh}`,
    en: `${verb.en} ${fallbackSubject.en}`
  })
}

export const formatToolActivityValueTask = (
  language: string | undefined,
  value: string | undefined,
  verb: ToolActivityLocalizedText,
  fallbackSubject: ToolActivityLocalizedText
) => {
  if (value) {
    return selectToolActivityText(language, {
      zh: `${verb.zh}${value}`,
      en: `${verb.en} ${value}`
    })
  }

  return selectToolActivityText(language, {
    zh: `${verb.zh}${fallbackSubject.zh}`,
    en: `${verb.en} ${fallbackSubject.en}`
  })
}
