import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDev } from '@main/core/platform'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'

const logger = loggerService.withContext('SearchService')

@Injectable('SearchService')
@ServicePhase(Phase.WhenReady)
export class SearchService extends BaseService {
  private searchWindows: Record<string, BrowserWindow> = {}

  protected async onInit() {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.SearchWindow_Open, async (_, uid: string, show?: boolean) => {
      await this.openSearchWindow(uid, show)
    })
    this.ipcHandle(IpcChannel.SearchWindow_Close, async (_, uid: string) => {
      await this.closeSearchWindow(uid)
    })
    this.ipcHandle(IpcChannel.SearchWindow_OpenUrl, async (_, uid: string, url: string) => {
      return await this.openUrlInSearchWindow(uid, url)
    })
  }

  protected async onStop() {
    for (const uid of Object.keys(this.searchWindows)) {
      this.searchWindows[uid]?.close()
    }
    this.searchWindows = {}
  }

  private async createNewSearchWindow(uid: string, show: boolean = false): Promise<BrowserWindow> {
    const newWindow = new BrowserWindow({
      width: 1280,
      height: 768,
      show,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: isDev
      }
    })

    this.searchWindows[uid] = newWindow
    newWindow.on('closed', () => delete this.searchWindows[uid])

    newWindow.webContents.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'

    return newWindow
  }

  public async openSearchWindow(uid: string, show: boolean = false): Promise<void> {
    const existingWindow = this.searchWindows[uid]

    if (existingWindow) {
      show && existingWindow.show()
      return
    }

    await this.createNewSearchWindow(uid, show)
  }

  public async closeSearchWindow(uid: string): Promise<void> {
    const window = this.searchWindows[uid]
    if (window) {
      window.close()
      delete this.searchWindows[uid]
    }
  }

  private async waitForSearchWindowSettle(): Promise<void> {
    await new Promise<void>((resolve) => {
      const settleDelay = setTimeout(resolve, 500)
      settleDelay.unref?.()
    })
  }

  public async openUrlInSearchWindow(uid: string, url: string): Promise<any> {
    let window = this.searchWindows[uid]
    logger.debug(`Searching with URL: ${url}`)
    if (!window) {
      window = await this.createNewSearchWindow(uid)
    }

    await window.loadURL(url)
    await this.waitForSearchWindowSettle()

    // Get the page content after ensuring it's fully loaded
    return await window.webContents.executeJavaScript('document.documentElement.outerHTML')
  }
}
