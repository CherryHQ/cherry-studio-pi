import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
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
import { installStorageV2RuntimeMirrors } from '@renderer/services/StorageV2Service'
import { useAppSelector } from '@renderer/store'
import { defaultLanguage } from '@shared/utils/languages'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef } from 'react'

import useFullScreenNotice from './useFullScreenNotice'
import { useMiniApps } from './useMiniApps'
import useNavBackgroundColor from './useNavBackgroundColor'
import { useNavbarPosition } from './useNavbar'

export function useAppInit() {
  const [language] = usePreference('app.language')
  const [windowStyle] = usePreference('ui.window_style')
  const [customCss] = usePreference('ui.custom_css')
  const [autoCheckUpdate] = usePreference('app.dist.auto_update.enabled')
  const [enableDataCollection] = usePreference('app.privacy.data_collection.enabled')
  const dataSyncSettings = useAppSelector((state) => state.settings)

  const { isLeftNavbar } = useNavbarPosition()
  const { miniAppShow } = useMiniApps()
  const { updateAppUpdateState } = useAppUpdateState()
  const savedAvatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()
  const navBackgroundColor = useNavBackgroundColor()
  const appInfoPromiseRef = useRef<ReturnType<typeof window.api.getAppInfo> | null>(null)

  const getAppInfoOnce = useCallback(() => {
    appInfoPromiseRef.current ??= window.api.getAppInfo()
    return appInfoPromiseRef.current
  }, [])

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
    let cancelled = false

    void window.api.getDataPathFromArgs().then((dataPath) => {
      if (cancelled) return
      if (dataPath) {
        void window.navigate({ to: '/settings/data', replace: true })
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    installStorageV2RuntimeMirrors()
  }, [])

  useEffect(() => {
    startDataSyncExternalSyncListener()

    return () => {
      stopDataSyncExternalSyncListener()
    }
  }, [])

  useEffect(() => {
    const hasCompleteWebdavConfig =
      dataSyncSettings.dataSyncAutoSync &&
      dataSyncSettings.dataSyncSyncInterval > 0 &&
      !!dataSyncSettings.dataSyncWebdavHost?.trim() &&
      !!dataSyncSettings.dataSyncWebdavUser?.trim() &&
      !!dataSyncSettings.dataSyncWebdavPass

    if (!hasCompleteWebdavConfig) {
      stopDataSyncAutoSync()
      return
    }

    startDataSyncAutoSync(false)

    return () => {
      stopDataSyncAutoSync()
    }
  }, [
    dataSyncSettings.dataSyncAutoSync,
    dataSyncSettings.dataSyncSyncInterval,
    dataSyncSettings.dataSyncWebdavHost,
    dataSyncSettings.dataSyncWebdavPass,
    dataSyncSettings.dataSyncWebdavUser
  ])

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
    let cancelled = false

    const checkForUpdates = async () => {
      const { isPackaged } = await getAppInfoOnce()

      if (cancelled || !isPackaged || !autoCheckUpdate) {
        return
      }

      const { updateInfo } = await window.api.checkForUpdate()
      if (!cancelled) {
        updateAppUpdateState({ info: updateInfo })
      }
    }

    const initialTimerId = autoCheckUpdate ? setTimeout(() => void checkForUpdates(), 2000) : undefined

    // Set up 4-hour interval check
    const FOUR_HOURS = 4 * 60 * 60 * 1000
    const intervalId = autoCheckUpdate ? setInterval(checkForUpdates, FOUR_HOURS) : undefined

    return () => {
      cancelled = true
      if (initialTimerId) clearTimeout(initialTimerId)
      if (intervalId) clearInterval(intervalId)
    }
  }, [autoCheckUpdate, getAppInfoOnce, updateAppUpdateState])

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
    let cancelled = false

    // set files path
    void getAppInfoOnce().then((info) => {
      if (cancelled) return
      cacheService.set('app.path.files', info.filesPath)
      cacheService.set('app.path.resources', info.resourcesPath)
    })

    return () => {
      cancelled = true
    }
  }, [getAppInfoOnce])

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
