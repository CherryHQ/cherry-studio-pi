import { application } from '@application'
import { loggerService } from '@logger'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE, RENDERER_GET_SETTINGS_BRIDGE } from '@shared/settingsBridge'

import { callRendererBridge, getBridgeErrorMessage } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { isSensitiveAgentKey, navigateApp, okResult, pickPath, sanitizeForAgent } from '../utils'

const logger = loggerService.withContext('AppCapability:Settings')
const SETTINGS_RENDERER_BRIDGE_CHECK_TIMEOUT_MS = 800
const SETTINGS_RENDERER_BRIDGE_CALL_TIMEOUT_MS = 1_500

export const SETTINGS_SECTIONS = [
  ['provider', 'Provider', '/settings/provider'],
  ['model', 'Models', '/settings/model'],
  ['api-gateway', 'API Gateway', '/settings/api-gateway'],
  ['mcp', 'MCP', '/settings/mcp'],
  ['websearch', 'Web Search', '/settings/websearch'],
  ['file-processing', 'Document processing', '/settings/file-processing'],
  ['integrations', 'Integrations', '/settings/integrations'],
  ['plugins', 'Environment dependencies', '/settings/plugins'],
  ['general', 'General', '/settings/general'],
  ['data', 'Data', '/settings/data'],
  ['channels', 'Channels', '/settings/channels'],
  ['scheduled-tasks', 'Scheduled tasks', '/settings/scheduled-tasks'],
  ['shortcut', 'Shortcuts', '/settings/shortcut'],
  ['quick-assistant', 'Quick Assistant', '/settings/quick-assistant'],
  ['selection-assistant', 'Selection Assistant', '/settings/selection-assistant'],
  ['prompts', 'Prompts', '/settings/prompts'],
  ['about', 'About', '/settings/about']
].map(([id, label, route]) => ({ id, label, route }))

export const SETTINGS_SETTERS: Record<string, string> = {
  defaultPaintingProvider: 'settings/setDefaultPaintingProvider',
  'apiServer.enabled': 'settings/setApiServerEnabled',
  'apiServer.port': 'settings/setApiServerPort',
  'apiServer.apiKey': 'settings/setApiServerApiKey'
}

const PREFERENCE_SETTING_PATHS: Record<string, UnifiedPreferenceKeyType> = {
  assistantIconType: 'assistant.icon_type',
  autoCheckUpdate: 'app.dist.auto_update.enabled',
  clickAssistantToShowTopic: 'assistant.click_to_show_topic',
  confirmDeleteMessage: 'chat.message.confirm_delete',
  confirmRegenerateMessage: 'chat.message.confirm_regenerate',
  defaultPaintingProvider: 'feature.paintings.default_provider',
  enableDeveloperMode: 'app.developer_mode.enabled',
  enableTopicNaming: 'topic.naming.enabled',
  fontSize: 'chat.message.font_size',
  language: 'app.language',
  launchOnBoot: 'app.launch_on_boot',
  launchToTray: 'app.tray.on_launch',
  localBackupAutoSync: 'data.backup.local.auto_sync',
  localBackupDir: 'data.backup.local.dir',
  localBackupMaxBackups: 'data.backup.local.max_backups',
  localBackupSkipBackupFile: 'data.backup.local.skip_backup_file',
  localBackupSyncInterval: 'data.backup.local.sync_interval',
  mathEnableSingleDollar: 'chat.message.math.single_dollar',
  mathEngine: 'chat.message.math.engine',
  messageStyle: 'chat.message.style',
  navbarPosition: 'ui.navbar.position',
  pasteLongTextAsFile: 'chat.input.paste_long_text_as_file',
  pasteLongTextThreshold: 'chat.input.paste_long_text_threshold',
  pinTopicsToTop: 'topic.tab.pin_to_top',
  proxyMode: 'app.proxy.mode',
  proxyUrl: 'app.proxy.url',
  renderInputMessageAsMarkdown: 'chat.message.render_as_markdown',
  sendMessageShortcut: 'chat.input.send_message_shortcut',
  showInputEstimatedTokens: 'chat.input.show_estimated_tokens',
  showMessageDivider: 'chat.message.show_divider',
  showPrompt: 'chat.message.show_prompt',
  showTopics: 'topic.tab.show',
  showTopicTime: 'topic.tab.show_time',
  targetLanguage: 'chat.input.translate.target_language',
  theme: 'ui.theme_mode',
  topicPosition: 'topic.position',
  tray: 'app.tray.enabled',
  trayOnClose: 'app.tray.on_close',
  webdavAutoSync: 'data.backup.webdav.auto_sync',
  webdavDisableStream: 'data.backup.webdav.disable_stream',
  webdavHost: 'data.backup.webdav.host',
  webdavMaxBackups: 'data.backup.webdav.max_backups',
  webdavPass: 'data.backup.webdav.pass',
  webdavPath: 'data.backup.webdav.path',
  webdavSkipBackupFile: 'data.backup.webdav.skip_backup_file',
  webdavSyncInterval: 'data.backup.webdav.sync_interval',
  webdavUser: 'data.backup.webdav.user',
  'apiServer.enabled': 'feature.api_gateway.enabled',
  'apiServer.host': 'feature.api_gateway.host',
  'apiServer.port': 'feature.api_gateway.port',
  'apiServer.apiKey': 'feature.api_gateway.api_key'
}
const pathEnum = Array.from(
  new Set([...Object.keys(SETTINGS_SETTERS), ...Object.keys(PREFERENCE_SETTING_PATHS)])
).sort()

function getRoutePathname(route: string) {
  return /^([^?#]*)/.exec(route)?.[1] || '/'
}

function normalizeSettingsRouteInput(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''

  const route = raw.startsWith('/') ? raw : `/${raw}`
  const pathname = getRoutePathname(route)
  if (!SETTINGS_SECTIONS.some((section) => section.route === pathname)) {
    throw new Error(`Unsupported settings route: ${route}`)
  }

  return route
}

function assignPath(target: Record<string, any>, keyPath: string, value: unknown) {
  const parts = keyPath.split('.').filter(Boolean)
  if (parts.length === 0) return

  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part]
    const next =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cursor[part] = next
    cursor = next
  }

  cursor[parts[parts.length - 1]] = value
}

function sanitizeSettingValueForAgent(keyPath: string, value: unknown) {
  if (isSensitiveAgentKey(keyPath)) {
    if (typeof value === 'string') return value ? '[redacted]' : value
    if (value === null || typeof value === 'undefined' || typeof value === 'boolean') return value
    return '[redacted]'
  }

  return sanitizeForAgent(value)
}

function sanitizeSettingsForAgent(value: unknown, keyPath = ''): unknown {
  if (keyPath && isSensitiveAgentKey(keyPath)) {
    return sanitizeSettingValueForAgent(keyPath, value)
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeSettingsForAgent(item, keyPath ? `${keyPath}.${index}` : String(index)))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeSettingsForAgent(item, keyPath ? `${keyPath}.${key}` : key)
      ])
    )
  }

  return sanitizeForAgent(value)
}

export async function readSettingsForAgent() {
  let settings: Record<string, any> = {}
  try {
    settings = await callRendererBridge<Record<string, any>>(RENDERER_GET_SETTINGS_BRIDGE, undefined, {
      checkTimeoutMs: SETTINGS_RENDERER_BRIDGE_CHECK_TIMEOUT_MS,
      timeoutMs: SETTINGS_RENDERER_BRIDGE_CALL_TIMEOUT_MS,
      timeoutMessage: 'Timed out reading settings'
    })
  } catch {
    settings = {}
  }

  try {
    const preferenceService = application.get('PreferenceService')
    const merged = { ...settings }
    for (const [keyPath, preferenceKey] of Object.entries(PREFERENCE_SETTING_PATHS)) {
      const value = preferenceService.get(preferenceKey)
      if (typeof value !== 'undefined') assignPath(merged, keyPath, value)
    }
    return merged
  } catch {
    return settings
  }
}

export function isSupportedSettingPath(keyPath: string) {
  return Boolean(SETTINGS_SETTERS[keyPath] || PREFERENCE_SETTING_PATHS[keyPath])
}

function readPreferenceSettingValue(keyPath: string): { found: true; value: unknown } | { found: false } {
  const preferenceKey = PREFERENCE_SETTING_PATHS[keyPath]
  if (!preferenceKey) return { found: false }

  try {
    const value = application.get('PreferenceService').get(preferenceKey)
    return typeof value === 'undefined' ? { found: false } : { found: true, value }
  } catch (error) {
    logger.warn('Failed to read preference-backed setting for app capability', {
      path: keyPath,
      preferenceKey,
      error: getBridgeErrorMessage(error)
    })
    return { found: false }
  }
}

export async function readSettingValueForAgent(keyPath: string) {
  const preferenceValue = readPreferenceSettingValue(keyPath)
  if (preferenceValue.found) return preferenceValue.value

  const settings = await readSettingsForAgent()
  return pickPath(settings, keyPath)
}

export async function persistSettingValue(keyPath: string, value: unknown) {
  const action = SETTINGS_SETTERS[keyPath]
  const preferenceKey = PREFERENCE_SETTING_PATHS[keyPath]
  if (!action && !preferenceKey) throw new Error(`Unsupported setting path: ${keyPath}`)

  if (preferenceKey) {
    await application.get('PreferenceService').set(preferenceKey, value as never)
  }

  if (action) {
    try {
      await callRendererBridge(
        RENDERER_DISPATCH_SETTINGS_ACTION_BRIDGE,
        { type: action, payload: value },
        {
          checkTimeoutMs: SETTINGS_RENDERER_BRIDGE_CHECK_TIMEOUT_MS,
          timeoutMs: SETTINGS_RENDERER_BRIDGE_CALL_TIMEOUT_MS,
          timeoutMessage: '写入设置超时'
        }
      )
    } catch (error) {
      if (preferenceKey) {
        logger.warn('Runtime setting dispatch failed after preference write; keeping persisted setting', {
          path: keyPath,
          preferenceKey,
          error: getBridgeErrorMessage(error)
        })
        return
      }
      throw new Error(`Failed to write runtime setting: ${getBridgeErrorMessage(error)}`)
    }
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
        return okResult('Settings read', { settings: sanitizeSettingsForAgent(settings) })
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
        return okResult('Setting value read', {
          path: keyPath,
          value: sanitizeSettingValueForAgent(keyPath, await readSettingValueForAgent(keyPath))
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
        const inputObject = input && typeof input === 'object' ? input : {}
        const keyPath = String(input?.path ?? '').trim()
        if (!keyPath) throw new Error('Setting path is required')
        if (!Object.prototype.hasOwnProperty.call(inputObject, 'value')) throw new Error('Setting value is required')
        if (!isSupportedSettingPath(keyPath)) throw new Error(`Unsupported setting path: ${keyPath}`)
        await persistSettingValue(keyPath, inputObject.value)
        return okResult('Setting updated', {
          path: keyPath,
          value: sanitizeSettingValueForAgent(keyPath, inputObject.value)
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
        const routeInput = normalizeSettingsRouteInput(input?.route)
        const section = SETTINGS_SECTIONS.find((item) => item.id === sectionInput)
        const route = section?.route || routeInput || '/settings/provider'
        await navigateApp(route)
        return okResult('Settings section opened', { route })
      }
    }
  ]
}
