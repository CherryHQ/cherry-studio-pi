import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isLinux, isPortable, isWin } from '@main/constant'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import { app } from 'electron'

// Please don't import any other modules which is not node/electron built-in modules

function hasWritePermission(path: string) {
  try {
    fs.accessSync(path, fs.constants.W_OK)
    return true
  } catch (error) {
    return false
  }
}

function getConfigDir() {
  return path.join(os.homedir(), HOME_CHERRY_DIR, 'config')
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2))
  fs.renameSync(tempPath, filePath)
}

function getCurrentExecutablePath() {
  if (isLinux && process.env.APPIMAGE) {
    return process.env.APPIMAGE
  }

  if (isWin && isPortable && process.env.PORTABLE_EXECUTABLE_FILE) {
    return process.env.PORTABLE_EXECUTABLE_FILE
  }

  return app.getPath('exe')
}

function getCompatibleExecutablePaths(executablePath: string) {
  const executablePaths = [executablePath]

  if (isLinux && process.env.APPIMAGE) {
    executablePaths.push(path.join(path.dirname(process.env.APPIMAGE), 'cherry-studio.appimage'))
  }

  if (isWin && isPortable && process.env.PORTABLE_EXECUTABLE_DIR) {
    executablePaths.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'cherry-studio-portable.exe'))
  }

  return Array.from(new Set(executablePaths))
}

export function initAppDataDir() {
  const appDataPath = getAppDataPathFromConfig()
  if (appDataPath) {
    app.setPath('userData', appDataPath)
    return
  }

  if (isPortable) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    app.setPath('userData', path.join(portableDir || app.getPath('exe'), 'data'))
    return
  }
}

function getAppDataPathFromConfig() {
  try {
    const configPath = path.join(getConfigDir(), 'config.json')
    if (!fs.existsSync(configPath)) {
      return null
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    if (!config.appDataPath) {
      return null
    }

    const executablePath = getCurrentExecutablePath()
    const compatibleExecutablePaths = new Set(getCompatibleExecutablePaths(executablePath))

    let appDataPath = null
    // 兼容旧版本
    if (config.appDataPath && typeof config.appDataPath === 'string') {
      appDataPath = config.appDataPath
      // 将旧版本数据迁移到新版本
      appDataPath && updateAppDataConfig(appDataPath)
    } else {
      appDataPath = config.appDataPath.find(
        (item: { executablePath: string }) => item.executablePath && compatibleExecutablePaths.has(item.executablePath)
      )?.dataPath
    }

    if (appDataPath && fs.existsSync(appDataPath) && hasWritePermission(appDataPath)) {
      return appDataPath
    }

    return null
  } catch (error) {
    return null
  }
}

export function updateAppDataConfig(appDataPath: string) {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  // config.json
  // appDataPath: [{ executablePath: string, dataPath: string }]
  const configPath = path.join(configDir, 'config.json')
  const executablePath = getCurrentExecutablePath()

  if (!fs.existsSync(configPath)) {
    writeJsonAtomic(configPath, { appDataPath: [{ executablePath, dataPath: appDataPath }] })
    return
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  if (!config.appDataPath || (config.appDataPath && typeof config.appDataPath !== 'object')) {
    config.appDataPath = []
  }

  const existingPath = config.appDataPath.find(
    (item: { executablePath: string }) => item.executablePath === executablePath
  )

  if (existingPath) {
    existingPath.dataPath = appDataPath
  } else {
    config.appDataPath.push({ executablePath, dataPath: appDataPath })
  }

  writeJsonAtomic(configPath, config)
}
