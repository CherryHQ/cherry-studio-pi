import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import { useAppUpdateHandler, useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import { useStorageMonitorNotification } from '@renderer/hooks/useStorageMonitorNotification'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import {
  startDataSyncAutoSync,
  startDataSyncExternalSyncListener,
  stopDataSyncAutoSync,
  stopDataSyncExternalSyncListener
} from '@renderer/services/DataSyncService'
import { useAppSelector } from '@renderer/store'
import { defaultLanguage } from '@shared/config/constant'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import useFullScreenNotice from './useFullScreenNotice'
import { useMiniApps } from './useMiniApps'
import useNavBackgroundColor from './useNavBackgroundColor'
import { useNavbarPosition } from './useNavbar'

const logger = loggerService.withContext('useAppInit')

export function useAppInit() {
  const [language] = usePreference('app.language')
  const [windowStyle] = usePreference('ui.window_style')
  const [customCss] = usePreference('ui.custom_css')
  const [autoCheckUpdate] = usePreference('app.dist.auto_update.enabled')
  const [enableDataCollection] = usePreference('app.privacy.data_collection.enabled')
  const dataSyncAutoSync = useAppSelector((state) => state.settings.dataSyncAutoSync)
  const dataSyncSyncInterval = useAppSelector((state) => state.settings.dataSyncSyncInterval)
  const dataSyncWebdavHost = useAppSelector((state) => state.settings.dataSyncWebdavHost)
  const dataSyncWebdavPass = useAppSelector((state) => state.settings.dataSyncWebdavPass)
  const dataSyncWebdavUser = useAppSelector((state) => state.settings.dataSyncWebdavUser)

  const { isLeftNavbar } = useNavbarPosition()
  const { miniAppShow } = useMiniApps()
  const { updateAppUpdateState } = useAppUpdateState()
  const savedAvatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()
  const navBackgroundColor = useNavBackgroundColor()

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    // Paired with `console.time('init')` in index.html's bootstrap script.
    // Both run in the browser console for dev DX (DevTools timer); the
    // timing isn't useful for production logs, so loggerService is not
    // appropriate here.
    // eslint-disable-next-line no-restricted-syntax
    console.timeEnd('init')
  }, [])

  useEffect(() => {
    void window.api
      .getDataPathFromArgs()
      .then((dataPath) => {
        if (dataPath) {
          void window.navigate({ to: '/settings/data', replace: true })
        }
      })
      .catch((error) => {
        logger.warn('Failed to read data path from launch args', error as Error)
      })
  }, [])

  // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
  // useEffect(() => {
  //   window.electron.ipcRenderer.on(IpcChannel.App_SaveData, async () => {
  //     await handleSaveData()
  //   })
  // }, [])

  useAppUpdateHandler()
  useFullScreenNotice()
  useStorageMonitorNotification()

  useEffect(() => {
    savedAvatar?.value && cacheService.set('app.user.avatar', savedAvatar.value)
  }, [savedAvatar])

  useEffect(() => {
    let active = true

    const checkForUpdates = async () => {
      try {
        const { isPackaged } = await window.api.getAppInfo()

        if (!active || !isPackaged || !autoCheckUpdate) {
          return
        }

        const { updateInfo } = await window.api.checkForUpdate()
        if (!active) {
          return
        }

        updateAppUpdateState({ info: updateInfo })
      } catch (error) {
        if (!active) {
          return
        }
        logger.warn('Failed to check for updates', error as Error)
      }
    }

    const initialCheckTimer = window.setTimeout(() => {
      void checkForUpdates()
    }, 2000)

    // Set up 4-hour interval check
    const FOUR_HOURS = 4 * 60 * 60 * 1000
    const intervalId = window.setInterval(() => {
      void checkForUpdates()
    }, FOUR_HOURS)

    return () => {
      active = false
      window.clearTimeout(initialCheckTimer)
      window.clearInterval(intervalId)
    }
  }, [autoCheckUpdate, updateAppUpdateState])

  useEffect(() => {
    const currentLanguage = language || navigator.language || defaultLanguage
    void i18n.changeLanguage(currentLanguage)
    setDayjsLocale(currentLanguage)
  }, [language])

  useEffect(() => {
    const isMacTransparentWindow = windowStyle === 'transparent' && isMac

    if (miniAppShow && isLeftNavbar) {
      window.root.style.background = isMacTransparentWindow ? 'var(--color-background)' : navBackgroundColor
      return
    }

    window.root.style.background = navBackgroundColor
  }, [windowStyle, miniAppShow, theme, isLeftNavbar, navBackgroundColor])

  useEffect(() => {
    // set files path
    void window.api
      .getAppInfo()
      .then((info) => {
        cacheService.set('app.path.files', info.filesPath)
        cacheService.set('app.path.resources', info.resourcesPath)
      })
      .catch((error) => {
        logger.warn('Failed to cache application paths', error as Error)
      })
  }, [])

  useEffect(() => {
    if (
      dataSyncAutoSync &&
      dataSyncSyncInterval > 0 &&
      dataSyncWebdavHost &&
      dataSyncWebdavUser &&
      dataSyncWebdavPass
    ) {
      startDataSyncAutoSync(false)
    } else {
      stopDataSyncAutoSync()
    }

    return () => {
      stopDataSyncAutoSync()
    }
  }, [dataSyncAutoSync, dataSyncSyncInterval, dataSyncWebdavHost, dataSyncWebdavPass, dataSyncWebdavUser])

  useEffect(() => {
    startDataSyncExternalSyncListener()

    return () => {
      stopDataSyncExternalSyncListener()
    }
  }, [])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  useEffect(() => {
    // TODO: init data collection
  }, [enableDataCollection])
}
