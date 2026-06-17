import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, nativeTheme } from 'electron'

const logger = loggerService.withContext('ThemeService')

@Injectable('ThemeService')
@ServicePhase(Phase.WhenReady)
export class ThemeService extends BaseService {
  private theme: ThemeMode = ThemeMode.system
  private readonly boundThemeUpdatedHandler = this.themeUpdatedHandler.bind(this)

  protected async onInit() {
    const preferenceService = application.get('PreferenceService')
    this.theme = preferenceService.get('ui.theme_mode')

    if (this.theme === ThemeMode.dark || this.theme === ThemeMode.light || this.theme === ThemeMode.system) {
      nativeTheme.themeSource = this.theme
    } else {
      void preferenceService.set('ui.theme_mode', ThemeMode.system)
      nativeTheme.themeSource = ThemeMode.system
    }

    nativeTheme.on('updated', this.boundThemeUpdatedHandler)
    this.registerDisposable(() => nativeTheme.removeListener('updated', this.boundThemeUpdatedHandler))

    this.registerDisposable(
      preferenceService.subscribeChange('ui.theme_mode', (newTheme) => {
        this.theme = newTheme
        nativeTheme.themeSource = newTheme
      })
    )
  }

  private themeUpdatedHandler() {
    const themeMode = nativeTheme.shouldUseDarkColors ? ThemeMode.dark : ThemeMode.light

    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed?.()) {
        continue
      }

      try {
        win.webContents.send(IpcChannel.NativeThemeUpdated, themeMode)
      } catch (error) {
        logger.warn('Failed to notify renderer window about native theme update', error as Error)
      }
    }
  }
}
