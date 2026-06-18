import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux } from '@main/core/platform'
import { quoteDesktopExecArg } from '@main/utils/desktopEntry'
import { summarizeTextForLog } from '@main/utils/logging'
import { IpcChannel } from '@shared/IpcChannel'
import { app } from 'electron'

import { handleMcpProtocolUrl } from './handlers/mcpInstall'
import { handleNavigateProtocolUrl } from './handlers/navigate'
import { handleProvidersProtocolUrl } from './handlers/providersImport'

export const CHERRY_STUDIO_PROTOCOL = 'cherrystudio'
const CHERRY_STUDIO_PROTOCOL_PREFIX = `${CHERRY_STUDIO_PROTOCOL}://`

const DESKTOP_FILE_NAME = 'cherrystudio-url-handler.desktop'
const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('ProtocolService')
const REGISTERED_PROTOCOL_HOSTS = new Set(['nutstore', 'ppio'])
const MAX_PENDING_PROTOCOL_CALLBACKS_PER_HOST = 5
const PENDING_PROTOCOL_CALLBACK_TTL_MS = 5 * 60 * 1000

type ProtocolDataPayload = {
  url: string
  params: Record<string, string>
}

type PendingProtocolDataPayload = ProtocolDataPayload & {
  createdAt: number
}

function isCherryStudioProtocolUrlArg(arg: string): boolean {
  return arg.toLowerCase().startsWith(CHERRY_STUDIO_PROTOCOL_PREFIX)
}

function normalizeProtocolHost(host: unknown): string {
  const normalized = typeof host === 'string' ? host.trim().toLowerCase() : ''
  if (!normalized || !/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error('Invalid protocol host listener')
  }
  return normalized
}

function buildProtocolPayload(url: URL): ProtocolDataPayload {
  return {
    url: url.toString(),
    params: Object.fromEntries(url.searchParams.entries())
  }
}

function buildSanitizedFallbackPayload(url: URL): ProtocolDataPayload {
  const sanitized = new URL(url.toString())
  sanitized.search = ''
  sanitized.hash = ''
  return {
    url: sanitized.toString(),
    params: {}
  }
}

@Injectable('ProtocolService')
@ServicePhase(Phase.Background)
// IMPORTANT: do NOT add @DependsOn(['MainWindowService']). MainWindowService is WhenReady,
// and auto-adjust would bump this service to WhenReady, causing macOS cold-start
// open-url events to fire before our listener attaches. MainWindowService is resolved
// at call time inside listener callbacks — safe because OS events fire post-bootstrap.
export class ProtocolService extends BaseService {
  private readonly protocolHostListeners = new Map<string, Set<string>>()
  private readonly pendingProtocolPayloads = new Map<string, PendingProtocolDataPayload[]>()

  protected async onInit() {
    // NOTE: Background phase's onInit runs on the first microtask after startPhase(),
    // which is before app.whenReady() (an OS-level event requiring the event loop).
    // This guarantees our open-url listener is attached before macOS cold-start URLs fire.

    // 1) Register OS-level protocol scheme
    this.registerProtocolScheme()
    this.registerProtocolIpcHandlers()

    // 2) macOS open-url listener (cold + hot start)
    const openUrlHandler = (event: Electron.Event, url: string) => {
      event.preventDefault()
      this.handleProtocolUrl(url)
    }
    app.on('open-url', openUrlHandler)
    this.registerDisposable(() => app.removeListener('open-url', openUrlHandler))

    // 3) Windows/Linux second-instance: sole owner.
    //    - argv carries `cherrystudio://...` → dispatch to URL handler; each handler
    //      self-routes focus (mcp / navigate raise Main, providers / oauth do not),
    //      so we never raise Main behind their backs.
    //    - argv carries no URL → plain re-launch (user double-clicked the icon while
    //      the app is running); surface the main window. MainWindowService is
    //      WhenReady, fully alive by the time any 'second-instance' can fire.
    const secondInstanceHandler = (_event: Electron.Event, argv: string[]) => {
      const url = argv.find(isCherryStudioProtocolUrlArg)
      if (url) {
        this.handleProtocolUrl(url)
      } else {
        application.get('MainWindowService').showMainWindow()
      }
    }
    app.on('second-instance', secondInstanceHandler)
    this.registerDisposable(() => app.removeListener('second-instance', secondInstanceHandler))

    // 4) Windows/Linux cold-start: initial argv may contain the URL
    this.handleArgvForUrl(process.argv)
  }

  protected async onAllReady() {
    // Runs after all bootstrap phases — application.getPath() is safe
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed((managed) => {
        this.removeWindowProtocolHostListeners(managed.id)
      })
    )
    await this.setupAppImageDeepLink()
  }

  private registerProtocolIpcHandlers() {
    this.ipcHandle(IpcChannel.Protocol_RegisterHostListener, (event, host: unknown) => {
      const normalizedHost = normalizeProtocolHost(host)
      const windowId = application.get('WindowManager').getWindowIdByWebContents(event.sender)
      if (!windowId) {
        throw new Error('Protocol listener sender is not a managed window')
      }

      const listeners = this.protocolHostListeners.get(normalizedHost) ?? new Set<string>()
      listeners.add(windowId)
      this.protocolHostListeners.set(normalizedHost, listeners)
      const deliveredPending = this.flushPendingProtocolPayloads(normalizedHost, windowId)
      return { host: normalizedHost, deliveredPending }
    })

    this.ipcHandle(IpcChannel.Protocol_UnregisterHostListener, (event, host: unknown) => {
      const normalizedHost = normalizeProtocolHost(host)
      const windowId = application.get('WindowManager').getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.removeProtocolHostListener(normalizedHost, windowId)
    })
  }

  private removeProtocolHostListener(host: string, windowId: string): boolean {
    const listeners = this.protocolHostListeners.get(host)
    if (!listeners) return false
    const removed = listeners.delete(windowId)
    if (listeners.size === 0) {
      this.protocolHostListeners.delete(host)
    }
    return removed
  }

  private removeWindowProtocolHostListeners(windowId: string): void {
    for (const [host, listeners] of this.protocolHostListeners.entries()) {
      listeners.delete(windowId)
      if (listeners.size === 0) {
        this.protocolHostListeners.delete(host)
      }
    }
  }

  private registerProtocolScheme() {
    // In dev, Electron needs the app entry as an absolute path; launchers often
    // pass "." as argv[1], which becomes invalid when the OS invokes the
    // protocol handler from a different cwd.
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const entry = process.argv[1]
        const absoluteEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry)
        app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL, process.execPath, [absoluteEntry])
      }
    } else {
      app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL)
    }
  }

  private handleProtocolUrl(url: string) {
    if (!url) return

    try {
      const urlObj = new URL(url)
      const host = urlObj.hostname.toLowerCase()

      switch (host) {
        case 'mcp':
          handleMcpProtocolUrl(urlObj)
          return
        case 'providers':
          handleProvidersProtocolUrl(urlObj).catch((error) =>
            logger.error('Failed to handle providers protocol URL', error as Error)
          )
          return
        case 'navigate':
          handleNavigateProtocolUrl(urlObj)
          return
        case 'oauth':
          // CherryIN OAuth callback. CherryInOauthService delivers the result
          // point-to-point to the renderer that started the flow, so the `code`
          // never reaches unrelated windows. PPIO/Nutstore deep links use
          // different hosts and still go through the broadcast fallback below.
          application
            .get('CherryInOauthService')
            .handleOAuthCallback(urlObj)
            .catch((error) => logger.error('Failed to handle CherryIN OAuth callback', error as Error))
          return
      }

      if (REGISTERED_PROTOCOL_HOSTS.has(host)) {
        const delivered = this.dispatchProtocolDataToRegisteredWindows(host, urlObj)
        if (delivered) {
          return
        }

        logger.warn('Sensitive protocol host has no registered listener yet, queueing callback for later delivery', {
          host
        })
        this.queueProtocolPayload(host, urlObj)
        return
      }

      // Default branch: deep link with no main-process handler. Fan out to every
      // managed renderer for compatibility only. Unknown hosts do not get query
      // or hash data in the fallback payload; OAuth-style schemes must register
      // their host through Protocol_RegisterHostListener or add an explicit
      // main-process case above before receiving sensitive callback values.
      application.get('WindowManager').broadcast(IpcChannel.Protocol_Data, buildSanitizedFallbackPayload(urlObj))
    } catch (error) {
      logger.error('Failed to handle protocol URL', error as Error)
    }
  }

  private dispatchProtocolDataToRegisteredWindows(host: string, url: URL): boolean {
    const listeners = this.protocolHostListeners.get(host)
    if (!listeners || listeners.size === 0) {
      return false
    }

    const payload = buildProtocolPayload(url)
    let delivered = false

    for (const windowId of [...listeners]) {
      const window = application.get('WindowManager').getWindow(windowId)
      if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) {
        listeners.delete(windowId)
        continue
      }

      try {
        window.webContents.send(IpcChannel.Protocol_Data, payload)
        delivered = true
      } catch (error) {
        listeners.delete(windowId)
        logger.warn('Failed to deliver protocol URL to registered renderer window', {
          host,
          windowId,
          error
        })
      }
    }

    if (listeners.size === 0) {
      this.protocolHostListeners.delete(host)
    }

    return delivered
  }

  private queueProtocolPayload(host: string, url: URL): void {
    const now = Date.now()
    const pending = this.getFreshPendingProtocolPayloads(host, now)
    pending.push({
      ...buildProtocolPayload(url),
      createdAt: now
    })
    this.pendingProtocolPayloads.set(host, pending.slice(-MAX_PENDING_PROTOCOL_CALLBACKS_PER_HOST))
  }

  private flushPendingProtocolPayloads(host: string, windowId: string): number {
    const pending = this.getFreshPendingProtocolPayloads(host)
    if (pending.length === 0) {
      return 0
    }

    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) {
      this.pendingProtocolPayloads.set(host, pending)
      return 0
    }

    let delivered = 0
    for (const { createdAt: _createdAt, ...payload } of pending) {
      window.webContents.send(IpcChannel.Protocol_Data, payload)
      delivered += 1
    }
    this.pendingProtocolPayloads.delete(host)
    return delivered
  }

  private getFreshPendingProtocolPayloads(host: string, now = Date.now()): PendingProtocolDataPayload[] {
    const pending = this.pendingProtocolPayloads.get(host) ?? []
    const fresh = pending.filter((payload) => now - payload.createdAt <= PENDING_PROTOCOL_CALLBACK_TTL_MS)
    if (fresh.length === 0) {
      this.pendingProtocolPayloads.delete(host)
    } else if (fresh.length !== pending.length) {
      this.pendingProtocolPayloads.set(host, fresh)
    }
    return fresh
  }

  private handleArgvForUrl(args: string[]) {
    const url = args.find(isCherryStudioProtocolUrlArg)
    if (url) this.handleProtocolUrl(url)
  }

  /**
   * Sets up deep linking for the AppImage build on Linux by creating a .desktop file.
   * This allows the OS to open cherrystudio:// URLs with this App.
   */
  private async setupAppImageDeepLink(): Promise<void> {
    // Only run on Linux and when packaged as an AppImage
    if (!isLinux || !process.env.APPIMAGE) {
      return
    }

    logger.debug('AppImage environment detected on Linux, setting up deep link.')

    try {
      const appPath = application.getPath('app.exe_file')
      if (!appPath) {
        logger.error('Could not determine App path.')
        return
      }

      const desktopFileContent = `[Desktop Entry]
Name=Cherry Studio Pi
Exec=${quoteDesktopExecArg(appPath)} %U
Terminal=false
Type=Application
MimeType=x-scheme-handler/${CHERRY_STUDIO_PROTOCOL};
NoDisplay=true
`

      // auto-ensure creates ~/.local/share/applications/ on first getPath() call
      const desktopFilePath = application.getPath('feature.protocol.desktop_entries', DESKTOP_FILE_NAME)
      await fs.writeFile(desktopFilePath, desktopFileContent, 'utf-8')
      logger.debug(`Created/Updated desktop file: ${desktopFilePath}`)

      try {
        const { stdout, stderr } = await execFileAsync('update-desktop-database', [
          application.getPath('feature.protocol.desktop_entries')
        ])
        if (stderr) {
          logger.warn('update-desktop-database stderr', { stderr: summarizeTextForLog(stderr) })
        }
        logger.debug('update-desktop-database stdout', { stdout: summarizeTextForLog(stdout) })
        logger.debug('Desktop database updated successfully.')
      } catch (updateError) {
        logger.error('Failed to update desktop database:', updateError as Error)
      }
    } catch (error) {
      logger.error('Failed to setup AppImage deep link:', error as Error)
    }
  }
}
