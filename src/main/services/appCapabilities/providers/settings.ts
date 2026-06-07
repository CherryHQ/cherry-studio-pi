import { application } from '@application'
import { reduxService } from '@main/services/ReduxService'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

import type { AppCapabilityDefinition } from '../types'
import { navigateApp, okResult, pickPath, sanitizeForAgent } from '../utils'

export const SETTINGS_SECTIONS = [
  ['provider', 'Provider', '/settings/provider'],
  ['model', 'Models', '/settings/model'],
  ['general', 'General', '/settings/general'],
  ['display', 'Display', '/settings/display'],
  ['data', 'Data', '/settings/data'],
  ['environment', 'Environment dependencies', '/settings/environment'],
  ['mcp', 'MCP', '/settings/mcp'],
  ['skills', 'Skills', '/settings/skills'],
  ['websearch', 'Web Search', '/settings/websearch'],
  ['memory', 'Memory', '/settings/memory'],
  ['api-server', 'API Server', '/settings/api-server'],
  ['channels', 'Channels', '/settings/channels'],
  ['scheduled-tasks', 'Scheduled tasks', '/settings/scheduled-tasks'],
  ['docprocess', 'Document processing', '/settings/docprocess'],
  ['quickphrase', 'Quick phrases', '/settings/quickphrase'],
  ['shortcut', 'Shortcuts', '/settings/shortcut'],
  ['quickAssistant', 'Quick Assistant', '/settings/quickAssistant'],
  ['selectionAssistant', 'Selection Assistant', '/settings/selectionAssistant'],
  ['about', 'About', '/settings/about']
].map(([id, label, route]) => ({ id, label, route }))

export const SETTINGS_SETTERS: Record<string, string> = {
  assistantIconType: 'settings/setAssistantIconType',
  autoCheckUpdate: 'settings/setAutoCheckUpdate',
  clickAssistantToShowTopic: 'settings/setClickAssistantToShowTopic',
  confirmDeleteMessage: 'settings/setConfirmDeleteMessage',
  confirmRegenerateMessage: 'settings/setConfirmRegenerateMessage',
  defaultPaintingProvider: 'settings/setDefaultPaintingProvider',
  enableDeveloperMode: 'settings/setEnableDeveloperMode',
  enableTopicNaming: 'settings/setEnableTopicNaming',
  fontSize: 'settings/setFontSize',
  language: 'settings/setLanguage',
  launchOnBoot: 'settings/setLaunchOnBoot',
  launchToTray: 'settings/setLaunchToTray',
  localBackupAutoSync: 'settings/setLocalBackupAutoSync',
  localBackupDir: 'settings/setLocalBackupDir',
  localBackupMaxBackups: 'settings/setLocalBackupMaxBackups',
  localBackupSkipBackupFile: 'settings/setLocalBackupSkipBackupFile',
  localBackupSyncInterval: 'settings/setLocalBackupSyncInterval',
  mathEnableSingleDollar: 'settings/setMathEnableSingleDollar',
  mathEngine: 'settings/setMathEngine',
  messageStyle: 'settings/setMessageStyle',
  navbarPosition: 'settings/setNavbarPosition',
  pasteLongTextAsFile: 'settings/setPasteLongTextAsFile',
  pasteLongTextThreshold: 'settings/setPasteLongTextThreshold',
  pinTopicsToTop: 'settings/setPinTopicsToTop',
  proxyMode: 'settings/setProxyMode',
  proxyUrl: 'settings/setProxyUrl',
  renderInputMessageAsMarkdown: 'settings/setRenderInputMessageAsMarkdown',
  s3: 'settings/setS3',
  s3Partial: 'settings/setS3Partial',
  sendMessageShortcut: 'settings/setSendMessageShortcut',
  showAssistants: 'settings/setShowAssistants',
  showInputEstimatedTokens: 'settings/setShowInputEstimatedTokens',
  showMessageDivider: 'settings/setShowMessageDivider',
  showPrompt: 'settings/setShowPrompt',
  showTopics: 'settings/setShowTopics',
  showTopicTime: 'settings/setShowTopicTime',
  targetLanguage: 'settings/setTargetLanguage',
  theme: 'settings/setTheme',
  topicPosition: 'settings/setTopicPosition',
  tray: 'settings/setTray',
  trayOnClose: 'settings/setTrayOnClose',
  webdavAutoSync: 'settings/setWebdavAutoSync',
  webdavDisableStream: 'settings/setWebdavDisableStream',
  webdavHost: 'settings/setWebdavHost',
  webdavMaxBackups: 'settings/setWebdavMaxBackups',
  webdavPass: 'settings/setWebdavPass',
  webdavPath: 'settings/setWebdavPath',
  webdavSkipBackupFile: 'settings/setWebdavSkipBackupFile',
  webdavSyncInterval: 'settings/setWebdavSyncInterval',
  webdavUser: 'settings/setWebdavUser',
  'apiServer.enabled': 'settings/setApiServerEnabled',
  'apiServer.port': 'settings/setApiServerPort',
  'apiServer.apiKey': 'settings/setApiServerApiKey'
}

const SENSITIVE_SETTING_PATH_PATTERN = /api[-_]?key|private[-_]?key|token|secret|pass|password|authorization|cookie/i
const PREFERENCE_SETTING_PATHS: Record<string, UnifiedPreferenceKeyType> = {
  defaultPaintingProvider: 'feature.paintings.default_provider',
  'apiServer.enabled': 'feature.csaas.enabled',
  'apiServer.host': 'feature.csaas.host',
  'apiServer.port': 'feature.csaas.port',
  'apiServer.apiKey': 'feature.csaas.api_key'
}
const pathEnum = Array.from(
  new Set([...Object.keys(SETTINGS_SETTERS), ...Object.keys(PREFERENCE_SETTING_PATHS)])
).sort()

function sanitizeSettingValueForAgent(keyPath: string, value: unknown) {
  if (SENSITIVE_SETTING_PATH_PATTERN.test(keyPath)) {
    if (typeof value === 'string') return value ? '[redacted]' : value
    if (value === null || typeof value === 'undefined' || typeof value === 'boolean') return value
    return '[redacted]'
  }

  return sanitizeForAgent(value)
}

export async function readSettingsForAgent() {
  const settings = (await reduxService.select('state.settings')) ?? {}
  try {
    const preferenceService = application.get('PreferenceService')
    const defaultPaintingProvider = preferenceService.get('feature.paintings.default_provider')
    return {
      ...settings,
      defaultPaintingProvider: defaultPaintingProvider ?? settings.defaultPaintingProvider,
      apiServer: {
        ...settings.apiServer,
        enabled: preferenceService.get('feature.csaas.enabled') ?? settings.apiServer?.enabled,
        host: preferenceService.get('feature.csaas.host') ?? settings.apiServer?.host,
        port: preferenceService.get('feature.csaas.port') ?? settings.apiServer?.port,
        apiKey: preferenceService.get('feature.csaas.api_key') ?? settings.apiServer?.apiKey
      }
    }
  } catch {
    return settings
  }
}

export function isSupportedSettingPath(keyPath: string) {
  return Boolean(SETTINGS_SETTERS[keyPath] || PREFERENCE_SETTING_PATHS[keyPath])
}

export async function persistSettingValue(keyPath: string, value: unknown) {
  const action = SETTINGS_SETTERS[keyPath]
  const preferenceKey = PREFERENCE_SETTING_PATHS[keyPath]
  if (!action && !preferenceKey) throw new Error(`Unsupported setting path: ${keyPath}`)

  if (preferenceKey) {
    await application.get('PreferenceService').set(preferenceKey, value as never)
  }

  if (action) {
    await reduxService.dispatch({ type: action, payload: value })
  }
}

export function createSettingsCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'settings.sections.list',
      domain: 'settings',
      kind: 'query',
      title: 'List settings sections',
      description: 'List configurable settings sections and their app routes.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['settings', 'preferences', 'sections'],
      execute: async () => okResult('Settings sections listed', { sections: SETTINGS_SECTIONS })
    },
    {
      id: 'settings.read',
      domain: 'settings',
      kind: 'query',
      title: 'Read settings',
      description: 'Read the current application settings with secrets redacted.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['settings', 'preferences', 'read'],
      execute: async () => {
        const settings = await readSettingsForAgent()
        return okResult('Settings read', { settings: sanitizeForAgent(settings) })
      }
    },
    {
      id: 'settings.value.get',
      domain: 'settings',
      kind: 'query',
      title: 'Get setting value',
      description: 'Read one setting value by path with secrets redacted.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Setting path, for example theme or apiServer.port' }
        },
        required: ['path']
      },
      risk: 'read',
      tags: ['settings', 'preferences', 'get'],
      execute: async (input: any) => {
        const keyPath = String(input?.path ?? '').trim()
        if (!keyPath) throw new Error('Setting path is required')
        const settings = await readSettingsForAgent()
        return okResult('Setting value read', {
          path: keyPath,
          value: sanitizeSettingValueForAgent(keyPath, pickPath(settings, keyPath))
        })
      }
    },
    {
      id: 'settings.value.set',
      domain: 'settings',
      kind: 'command',
      title: 'Update setting value',
      description: 'Update a supported application setting by path.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: pathEnum, description: 'Supported setting path to update' },
          value: { description: 'New setting value' }
        },
        required: ['path', 'value']
      },
      risk: 'write',
      permissions: ['settings.write'],
      tags: ['settings', 'preferences', 'update', 'write'],
      examples: ['Change language', 'Set theme', 'Set default painting provider', 'Enable API server'],
      execute: async (input: any) => {
        const keyPath = String(input?.path ?? '').trim()
        if (!keyPath) throw new Error('Setting path is required')
        if (!isSupportedSettingPath(keyPath)) throw new Error(`Unsupported setting path: ${keyPath}`)
        await persistSettingValue(keyPath, input?.value)
        return okResult('Setting updated', {
          path: keyPath,
          value: sanitizeSettingValueForAgent(keyPath, input?.value)
        })
      }
    },
    {
      id: 'settings.open',
      domain: 'settings',
      kind: 'command',
      title: 'Open settings section',
      description: 'Open a settings section in the main window for human observation or intervention.',
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Settings section id, for example data, model, mcp, or about' },
          route: { type: 'string', description: 'Optional explicit settings route' }
        }
      },
      risk: 'read',
      tags: ['settings', 'navigation', 'open'],
      execute: async (input: any) => {
        const sectionInput = typeof input?.section === 'string' ? input.section.trim() : ''
        const routeInput = typeof input?.route === 'string' ? input.route.trim() : ''
        const section = SETTINGS_SECTIONS.find((item) => item.id === sectionInput || item.route === routeInput)
        const route = section?.route || routeInput || '/settings/provider'
        await navigateApp(route)
        return okResult('Settings section opened', { route })
      }
    }
  ]
}
