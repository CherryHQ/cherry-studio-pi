import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/constant'
import ElectronShutdownHandler from '@paymoapp/electron-shutdown-handler'
import { BrowserWindow } from 'electron'
import { powerMonitor } from 'electron'

const logger = loggerService.withContext('PowerMonitorService')
const SHUTDOWN_HANDLER_TIMEOUT_MS = 10_000

type ShutdownHandler = () => void | Promise<void>

export class PowerMonitorService {
  private static instance: PowerMonitorService
  private initialized = false
  private shutdownHandlers: ShutdownHandler[] = []
  private shutdownWindow: BrowserWindow | null = null

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static getInstance(): PowerMonitorService {
    if (!PowerMonitorService.instance) {
      PowerMonitorService.instance = new PowerMonitorService()
    }
    return PowerMonitorService.instance
  }

  /**
   * Register a shutdown handler to be called when system shutdown is detected
   * @param handler - The handler function to be called on shutdown
   */
  public registerShutdownHandler(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler)
    logger.info('Shutdown handler registered', { totalHandlers: this.shutdownHandlers.length })
  }

  /**
   * Initialize power monitor to listen for shutdown events
   */
  public init(): void {
    if (this.initialized) {
      logger.warn('PowerMonitorService already initialized')
      return
    }

    this.initPowerStateListeners()

    if (isWin) {
      this.initWindowsShutdownHandler()
    } else if (isMac || isLinux) {
      this.initElectronPowerMonitor()
    }

    this.initialized = true
    logger.info('PowerMonitorService initialized', { platform: process.platform })
  }

  private initPowerStateListeners(): void {
    try {
      powerMonitor.on('suspend', () => {
        logger.warn('System suspend event detected', { platform: process.platform })
      })
      powerMonitor.on('resume', () => {
        logger.info('System resume event detected', { platform: process.platform })
      })
      powerMonitor.on('on-ac', () => {
        logger.info('System switched to AC power')
      })
      powerMonitor.on('on-battery', () => {
        logger.info('System switched to battery power')
      })
      powerMonitor.on('speed-limit-change', (details) => {
        logger.warn('System CPU speed limit changed', { limit: details.limit })
      })
      logger.info('Electron power state listeners registered')
    } catch (error) {
      logger.error('Failed to initialize power state listeners', error as Error)
    }
  }

  /**
   * Execute all registered shutdown handlers
   */
  private async executeShutdownHandlers(): Promise<void> {
    logger.info('Executing shutdown handlers', { count: this.shutdownHandlers.length })
    for (const handler of this.shutdownHandlers) {
      try {
        await this.runShutdownHandlerWithTimeout(handler)
      } catch (error) {
        logger.error('Error executing shutdown handler', error as Error)
      }
    }
  }

  private async runShutdownHandlerWithTimeout(handler: ShutdownHandler): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null

      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      timeout = setTimeout(() => {
        finish(new Error(`Shutdown handler timed out after ${SHUTDOWN_HANDLER_TIMEOUT_MS}ms`))
      }, SHUTDOWN_HANDLER_TIMEOUT_MS)
      timeout.unref?.()

      Promise.resolve()
        .then(handler)
        .then(() => finish())
        .catch((error) => finish(error as Error))
    })
  }

  /**
   * Initialize shutdown handler for Windows using @paymoapp/electron-shutdown-handler
   */
  private initWindowsShutdownHandler(): void {
    try {
      this.shutdownWindow = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        focusable: false,
        frame: false,
        webPreferences: {
          sandbox: true
        }
      })
      // Set the window handle for the shutdown handler
      ElectronShutdownHandler.setWindowHandle(this.shutdownWindow.getNativeWindowHandle())

      // Listen for shutdown event
      ElectronShutdownHandler.on('shutdown', async () => {
        logger.info('System shutdown event detected (Windows)')
        // Execute all registered shutdown handlers
        await this.executeShutdownHandlers()
        // Release the shutdown block to allow the system to shut down
        ElectronShutdownHandler.releaseShutdown()
      })

      logger.info('Windows shutdown handler registered')
    } catch (error) {
      this.shutdownWindow?.destroy()
      this.shutdownWindow = null
      logger.error('Failed to initialize Windows shutdown handler', error as Error)
    }
  }

  /**
   * Initialize power monitor for macOS and Linux using Electron's powerMonitor
   */
  private initElectronPowerMonitor(): void {
    try {
      powerMonitor.on('shutdown', async () => {
        logger.info('System shutdown event detected', { platform: process.platform })
        // Execute all registered shutdown handlers
        await this.executeShutdownHandlers()
      })

      logger.info('Electron powerMonitor shutdown listener registered')
    } catch (error) {
      logger.error('Failed to initialize Electron powerMonitor', error as Error)
    }
  }
}

// Default export as singleton instance
export default PowerMonitorService.getInstance()
