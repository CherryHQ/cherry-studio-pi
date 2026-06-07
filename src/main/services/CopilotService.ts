import { application } from '@application'
import { loggerService } from '@logger'
import { net, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

import { getConfigDir } from '../utils/file'
import { storageV2SecretVaultService } from './storageV2/SecretVaultService'
import { storageV2SettingsRepository } from './storageV2/StorageV2Repositories'

const logger = loggerService.withContext('CopilotService')
const STORAGE_V2_COPILOT_SCOPE = 'copilot'
const STORAGE_V2_COPILOT_SETTING_KEY = 'copilot.accessToken'

// 配置常量，集中管理
const CONFIG = {
  GITHUB_CLIENT_ID: 'Iv1.b507a08c87ecfe98',
  POLLING: {
    MAX_ATTEMPTS: 8,
    INITIAL_DELAY_MS: 1000,
    MAX_DELAY_MS: 16000 // 最大延迟16秒
  },
  DEFAULT_HEADERS: {
    accept: 'application/json',
    'editor-version': 'Neovim/0.6.1',
    'editor-plugin-version': 'copilot.vim/1.16.0',
    'content-type': 'application/json',
    'user-agent': 'GithubCopilot/1.155.0',
    'accept-encoding': 'gzip,deflate,br'
  },
  // API端点集中管理
  API_URLS: {
    GITHUB_USER: 'https://api.github.com/user',
    GITHUB_DEVICE_CODE: 'https://github.com/login/device/code',
    GITHUB_ACCESS_TOKEN: 'https://github.com/login/oauth/access_token',
    COPILOT_TOKEN: 'https://api.github.com/copilot_internal/v2/token'
  },
  TOKEN_FILE_NAME: '.copilot_token',
  REQUEST_TIMEOUT_MS: 30_000
}

// 接口定义移到顶部，便于查阅
interface UserResponse {
  login: string
  avatar: string
}

interface AuthResponse {
  device_code: string
  user_code: string
  verification_uri: string
}

interface TokenResponse {
  access_token: string
}

interface CopilotTokenResponse {
  token: string
}

type CopilotAccessTokenSetting = {
  accessTokenSecretRef?: string
  clearedAt?: string
  legacyFallbackAt?: string
  updatedAt?: string
}

type StoredAccessTokenResult = {
  cleared: boolean
  token: string | null
}

// 自定义错误类，统一错误处理
class CopilotServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CopilotServiceError'
  }
}

class CopilotService {
  // Memoized backing field for the lazy `tokenFilePath` getter below.
  // `undefined` until first access; resolved exactly once and cached.
  private _tokenFilePath: string | undefined
  private headers: Record<string, string>

  constructor() {
    this.headers = {
      ...CONFIG.DEFAULT_HEADERS,
      accept: 'application/json',
      'user-agent': 'Visual Studio Code (desktop)'
    }
  }

  // TODO(v2): Lazy + memoized getter is a workaround, not a fix.
  //
  // The real problem is that `CopilotService` is exported as a top-level
  // singleton at the bottom of this file
  // (`export const copilotService = new CopilotService()`). That
  // singleton is instantiated during the static import graph of
  // `src/main/index.ts` (via `ipc.ts`), BEFORE
  // `application.bootstrap()` runs and builds the path registry. The
  // previous shape resolved `tokenFilePath` in the constructor
  // (`this.tokenFilePath = this.getTokenFilePath()`), which called
  // `application.getPath(...)` at instantiation time and threw
  // "PATHS not initialized".
  //
  // Lazy + cached resolution defers the path lookup until first *access*
  // (cached because `getTokenFilePath` does an `fs.existsSync` syscall
  // for the legacy-path fallback — we don't want that on every read).
  // But the class itself is still being constructed too early. We've
  // merely moved the path lookup out of construction; we have NOT
  // solved the architectural issue.
  //
  // The proper v2 fix is to migrate `CopilotService` into the lifecycle
  // system: extend `BaseService`, add `@Injectable`, register in
  // `serviceRegistry.ts`, and have callers resolve it via
  // `application.get('CopilotService')` instead of importing the
  // singleton. Once that's done, the DI container will instantiate it
  // inside `application.bootstrap()` after the path registry is built,
  // and the constructor can resolve `tokenFilePath` directly again.
  // Until then, keep this lazy getter — do NOT move the assignment
  // back to the constructor.
  private get tokenFilePath(): string {
    return (this._tokenFilePath ??= this.getTokenFilePath())
  }

  private getTokenFilePath = (): string => {
    // Legacy path: token was previously stored directly under userData
    const oldTokenFilePath = path.join(application.getPath('app.userdata'), CONFIG.TOKEN_FILE_NAME)
    if (fs.existsSync(oldTokenFilePath)) {
      return oldTokenFilePath
    }
    return application.getPath('feature.copilot.token_file')
  }

  private getLegacyTokenFilePaths = (): string[] => {
    return Array.from(
      new Set([
        path.join(application.getPath('app.userdata'), CONFIG.TOKEN_FILE_NAME),
        path.join(getConfigDir(), CONFIG.TOKEN_FILE_NAME),
        this.tokenFilePath
      ])
    )
  }

  private request = (url: string, init: RequestInit): Promise<Response> => {
    return net.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT_MS)
    })
  }

  /**
   * 设置自定义请求头
   */
  private updateHeaders = (headers?: Record<string, string>): void => {
    if (headers && Object.keys(headers).length > 0) {
      this.headers = { ...headers }
    }
  }

  private getAccessTokenSecretRef = (setting: unknown): string | null => {
    if (!setting || typeof setting !== 'object' || Array.isArray(setting)) {
      return null
    }

    const secretRef = (setting as CopilotAccessTokenSetting).accessTokenSecretRef
    return typeof secretRef === 'string' && secretRef ? secretRef : null
  }

  private isStorageV2Cleared = (setting: unknown): boolean => {
    return Boolean(
      setting &&
        typeof setting === 'object' &&
        !Array.isArray(setting) &&
        (setting as CopilotAccessTokenSetting).clearedAt
    )
  }

  private readAccessTokenFromStorageV2 = async (): Promise<StoredAccessTokenResult> => {
    const setting = await storageV2SettingsRepository.get(STORAGE_V2_COPILOT_SETTING_KEY)
    if (this.isStorageV2Cleared(setting)) {
      return {
        cleared: true,
        token: null
      }
    }

    const secretRef = this.getAccessTokenSecretRef(setting)
    if (!secretRef) {
      return {
        cleared: false,
        token: null
      }
    }

    const secret = await storageV2SecretVaultService.getSecret(secretRef)
    return {
      cleared: false,
      token: secret || null
    }
  }

  private decodeLegacyAccessToken = (raw: string | Buffer): string => {
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    try {
      const decrypted = safeStorage.decryptString(buffer).trim()
      if (decrypted) {
        return decrypted
      }
    } catch {
      // Older dev/test token files were sometimes plain text; keep a safe fallback
      // so existing users are migrated instead of forced through OAuth again.
    }

    return buffer.toString('utf-8').trim()
  }

  private readLegacyAccessToken = async (): Promise<string | null> => {
    for (const filePath of this.getLegacyTokenFilePaths()) {
      try {
        const raw = await fs.promises.readFile(filePath)
        const token = this.decodeLegacyAccessToken(raw)
        if (token) {
          return token
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          logger.warn(`Failed to read legacy Copilot token from ${filePath}:`, error as Error)
        }
      }
    }

    return null
  }

  private saveAccessTokenToStorageV2 = async (token: string): Promise<void> => {
    const secretRef = await storageV2SecretVaultService.setSecret(
      STORAGE_V2_COPILOT_SCOPE,
      'github',
      'accessToken',
      token
    )
    await storageV2SettingsRepository.set(
      STORAGE_V2_COPILOT_SETTING_KEY,
      {
        accessTokenSecretRef: secretRef,
        updatedAt: new Date().toISOString()
      } satisfies CopilotAccessTokenSetting,
      STORAGE_V2_COPILOT_SCOPE
    )
  }

  private markAccessTokenCleared = async (): Promise<void> => {
    const timestamp = new Date().toISOString()
    await storageV2SettingsRepository.set(
      STORAGE_V2_COPILOT_SETTING_KEY,
      {
        clearedAt: timestamp,
        updatedAt: timestamp
      } satisfies CopilotAccessTokenSetting,
      STORAGE_V2_COPILOT_SCOPE
    )
  }

  private removeLegacyTokenFiles = async (throwOnFailure = false): Promise<void> => {
    for (const filePath of this.getLegacyTokenFilePaths()) {
      try {
        await fs.promises.unlink(filePath)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue
        }

        logger.warn(`Failed to remove legacy Copilot token from ${filePath}:`, error as Error)
        if (throwOnFailure) {
          throw error
        }
      }
    }
  }

  private getStoredAccessToken = async (): Promise<string | null> => {
    const storageV2Result = await this.readAccessTokenFromStorageV2().catch((error): StoredAccessTokenResult => {
      logger.warn('Failed to read Copilot access token from Storage v2:', error as Error)
      return {
        cleared: false,
        token: null
      }
    })

    if (storageV2Result.cleared) {
      return null
    }

    if (storageV2Result.token) {
      return storageV2Result.token
    }

    const legacyToken = await this.readLegacyAccessToken()
    if (!legacyToken) {
      return null
    }

    await this.saveAccessTokenToStorageV2(legacyToken).catch(async (error) => {
      logger.warn('Failed to mirror legacy Copilot token to Storage v2:', error as Error)
      const timestamp = new Date().toISOString()
      await storageV2SettingsRepository
        .set(
          STORAGE_V2_COPILOT_SETTING_KEY,
          {
            legacyFallbackAt: timestamp,
            updatedAt: timestamp
          } satisfies CopilotAccessTokenSetting,
          STORAGE_V2_COPILOT_SCOPE
        )
        .catch((fallbackError) => {
          logger.warn('Failed to record Copilot legacy token fallback:', fallbackError as Error)
        })
    })

    return legacyToken
  }

  /**
   * 获取GitHub登录信息
   */
  public getUser = async (_: Electron.IpcMainInvokeEvent, token: string): Promise<UserResponse> => {
    try {
      const response = await this.request(CONFIG.API_URLS.GITHUB_USER, {
        method: 'GET',
        headers: {
          Connection: 'keep-alive',
          'user-agent': 'Visual Studio Code (desktop)',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Dest': 'empty',
          accept: 'application/json',
          authorization: `token ${token}`
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        login: data.login,
        avatar: data.avatar_url
      }
    } catch (error) {
      logger.error('Failed to get user information:', error as Error)
      throw new CopilotServiceError('无法获取GitHub用户信息', error)
    }
  }

  /**
   * 获取GitHub设备授权信息
   */
  public getAuthMessage = async (
    _: Electron.IpcMainInvokeEvent,
    headers?: Record<string, string>
  ): Promise<AuthResponse> => {
    try {
      this.updateHeaders(headers)

      const response = await this.request(CONFIG.API_URLS.GITHUB_DEVICE_CODE, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: CONFIG.GITHUB_CLIENT_ID,
          scope: 'read:user'
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return (await response.json()) as AuthResponse
    } catch (error) {
      logger.error('Failed to get auth message:', error as Error)
      throw new CopilotServiceError('无法获取GitHub授权信息', error)
    }
  }

  /**
   * 使用设备码获取访问令牌 - 优化轮询逻辑
   */
  public getCopilotToken = async (
    _: Electron.IpcMainInvokeEvent,
    device_code: string,
    headers?: Record<string, string>
  ): Promise<TokenResponse> => {
    this.updateHeaders(headers)

    let currentDelay = CONFIG.POLLING.INITIAL_DELAY_MS

    for (let attempt = 0; attempt < CONFIG.POLLING.MAX_ATTEMPTS; attempt++) {
      await this.delay(currentDelay)

      try {
        const response = await this.request(CONFIG.API_URLS.GITHUB_ACCESS_TOKEN, {
          method: 'POST',
          headers: {
            ...this.headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client_id: CONFIG.GITHUB_CLIENT_ID,
            device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = (await response.json()) as TokenResponse
        const { access_token } = data
        if (access_token) {
          return { access_token }
        }
      } catch (error) {
        // 指数退避策略
        currentDelay = Math.min(currentDelay * 2, CONFIG.POLLING.MAX_DELAY_MS)

        // 仅在最后一次尝试失败时记录详细错误
        const isLastAttempt = attempt === CONFIG.POLLING.MAX_ATTEMPTS - 1
        if (isLastAttempt) {
          logger.error(`Token polling failed after ${CONFIG.POLLING.MAX_ATTEMPTS} attempts:`, error as Error)
        }
      }
    }

    throw new CopilotServiceError('获取访问令牌超时，请重试')
  }

  /**
   * 保存Copilot令牌到本地文件
   */
  public saveCopilotToken = async (_: Electron.IpcMainInvokeEvent, token: string): Promise<void> => {
    try {
      await this.saveAccessTokenToStorageV2(token)
      await this.removeLegacyTokenFiles()
    } catch (error) {
      logger.error('Failed to save token:', error as Error)
      throw new CopilotServiceError('无法保存访问令牌', error)
    }
  }

  /**
   * 从本地文件读取令牌并获取Copilot令牌
   */
  public getToken = async (
    _: Electron.IpcMainInvokeEvent,
    headers?: Record<string, string>
  ): Promise<CopilotTokenResponse> => {
    try {
      this.updateHeaders(headers)

      const access_token = await this.getStoredAccessToken()
      if (!access_token) {
        throw new Error('No Copilot access token found')
      }

      const response = await this.request(CONFIG.API_URLS.COPILOT_TOKEN, {
        method: 'GET',
        headers: {
          ...this.headers,
          authorization: `token ${access_token}`
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return (await response.json()) as CopilotTokenResponse
    } catch (error) {
      logger.error('Failed to get Copilot token:', error as Error)
      throw new CopilotServiceError('无法获取Copilot令牌，请重新授权', error)
    }
  }

  /**
   * 退出登录，删除本地token文件
   */
  public logout = async (): Promise<void> => {
    try {
      await this.markAccessTokenCleared()
      await this.removeLegacyTokenFiles(true)
      logger.debug('Successfully logged out from Copilot')
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CopilotServiceError('无法完成退出登录操作', error)
    }
  }

  /**
   * 辅助方法：延迟执行
   */
  private delay = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const copilotService = new CopilotService()
