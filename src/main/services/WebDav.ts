import { loggerService } from '@logger'
import { normalizeWebDavConfig } from '@shared/webdavConfig'
import type { WebDavConfig } from '@types'
import path from 'path'
import type Stream from 'stream'
import type {
  BufferLike,
  CreateDirectoryOptions,
  GetFileContentsOptions,
  PutFileContentsOptions,
  WebDAVClient
} from 'webdav'
import { createClient } from 'webdav'

import { createWebDavClientOptions } from './WebDavClientOptions'
import { getWebDavErrorStatus } from './WebDavRetry'

const logger = loggerService.withContext('WebDav')
const DEFAULT_BACKUP_WEBDAV_PATH = '/cherry-studio-pi'
const REMOTE_DIRECTORY_ALREADY_EXISTS_STATUSES = new Set([405, 409, 412])

function redactWebDavHostForLog(webdavHost: string) {
  try {
    const url = new URL(webdavHost)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return webdavHost.replace(/\s+/g, ' ')
  }
}

function isRemotePathInside(targetPath: string, rootPath: string) {
  const relativePath = path.posix.relative(rootPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.posix.isAbsolute(relativePath))
}

function mayBeConcurrentDirectoryCreateError(error: unknown) {
  const status = getWebDavErrorStatus(error)
  return status !== null && REMOTE_DIRECTORY_ALREADY_EXISTS_STATUSES.has(status)
}

async function verifyDirectoryExistsAfterCreateFailure(
  client: WebDAVClient,
  dirPath: string,
  createError: unknown,
  context: string
) {
  try {
    return await client.exists(dirPath)
  } catch (error) {
    logger.error(`Error checking WebDAV directory after ${context} failure:`, error as Error, {
      dirPath,
      createStatus: getWebDavErrorStatus(createError)
    })
    throw error
  }
}

export default class WebDav {
  public instance: WebDAVClient | undefined
  private webdavPath: string

  constructor(params: WebDavConfig) {
    const normalizedConfig = normalizeWebDavConfig(params, {
      defaultPath: DEFAULT_BACKUP_WEBDAV_PATH,
      requireCredentials: true
    })

    this.webdavPath = normalizedConfig.webdavPath || '/'

    logger.info('Creating WebDAV client', {
      host: redactWebDavHostForLog(normalizedConfig.webdavHost),
      path: this.webdavPath,
      hasUsername: Boolean(normalizedConfig.webdavUser),
      hasPassword: Boolean(normalizedConfig.webdavPass)
    })

    this.instance = createClient(
      normalizedConfig.webdavHost,
      createWebDavClientOptions({
        username: normalizedConfig.webdavUser,
        password: normalizedConfig.webdavPass
      })
    )

    this.putFileContents = this.putFileContents.bind(this)
    this.getFileContents = this.getFileContents.bind(this)
    this.createDirectory = this.createDirectory.bind(this)
    this.deleteFile = this.deleteFile.bind(this)
  }

  private resolveRemoteFilePath(filename: string) {
    const normalizedFileName = String(filename || '')
      .trim()
      .replace(/\\/g, '/')
    if (!normalizedFileName || normalizedFileName.includes('\0')) {
      throw new Error('Invalid WebDAV file name')
    }

    const remoteFilePath = path.posix.normalize(path.posix.join(this.webdavPath, normalizedFileName))
    if (remoteFilePath === this.webdavPath || !isRemotePathInside(remoteFilePath, this.webdavPath)) {
      throw new Error('WebDAV file path is outside the configured directory')
    }
    return remoteFilePath
  }

  private resolveRemoteDirectoryPath(directoryPath: string) {
    const normalizedDirectoryPath = String(directoryPath || '')
      .trim()
      .replace(/\\/g, '/')
    if (!normalizedDirectoryPath || normalizedDirectoryPath.includes('\0')) {
      throw new Error('Invalid WebDAV directory path')
    }

    const remoteDirectoryPath = path.posix.normalize(
      normalizedDirectoryPath.startsWith('/')
        ? normalizedDirectoryPath
        : path.posix.join(this.webdavPath, normalizedDirectoryPath)
    )
    if (!isRemotePathInside(remoteDirectoryPath, this.webdavPath)) {
      throw new Error('WebDAV directory path is outside the configured directory')
    }
    return remoteDirectoryPath
  }

  private async ensureRemoteDirectory(dirPath: string) {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    if (dirPath === '/') return

    try {
      if (!(await this.instance.exists(dirPath))) {
        await this.instance.createDirectory(dirPath, {
          recursive: true
        })
      }
    } catch (error) {
      if (mayBeConcurrentDirectoryCreateError(error)) {
        const existsAfterFailure = await verifyDirectoryExistsAfterCreateFailure(
          this.instance,
          dirPath,
          error,
          'parent directory create'
        )
        if (existsAfterFailure) {
          logger.warn('WebDAV directory already exists after create failure; continuing', {
            dirPath,
            status: getWebDavErrorStatus(error)
          })
          return
        }
      }
      logger.error('Error creating directory on WebDAV:', error as Error)
      throw error
    }
  }

  public putFileContents = async (
    filename: string,
    data: string | BufferLike | Stream.Readable,
    options?: PutFileContentsOptions
  ) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = this.resolveRemoteFilePath(filename)
    await this.ensureRemoteDirectory(path.posix.dirname(remoteFilePath))

    try {
      return await this.instance.putFileContents(remoteFilePath, data, options)
    } catch (error) {
      logger.error('Error putting file contents on WebDAV:', error as Error)
      throw error
    }
  }

  public getFileContents = async (filename: string, options?: GetFileContentsOptions) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = this.resolveRemoteFilePath(filename)

    try {
      return await this.instance.getFileContents(remoteFilePath, options)
    } catch (error) {
      logger.error('Error getting file contents on WebDAV:', error as Error)
      throw error
    }
  }

  public getDirectoryContents = async () => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      if (!(await this.instance.exists(this.webdavPath))) {
        return []
      }
      return await this.instance.getDirectoryContents(this.webdavPath)
    } catch (error) {
      const status = (error as { status?: unknown })?.status
      if (status === 404) {
        return []
      }
      logger.error('Error getting directory contents on WebDAV:', error as Error)
      throw error
    }
  }

  public checkConnection = async () => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    try {
      if (await this.instance.exists(this.webdavPath)) {
        return true
      }

      await this.instance.createDirectory(this.webdavPath, {
        recursive: true
      })
      return true
    } catch (error) {
      if (mayBeConcurrentDirectoryCreateError(error)) {
        const existsAfterFailure = await verifyDirectoryExistsAfterCreateFailure(
          this.instance,
          this.webdavPath,
          error,
          'root directory create'
        )
        if (existsAfterFailure) {
          logger.warn('WebDAV root directory already exists after create failure; continuing', {
            path: this.webdavPath,
            status: getWebDavErrorStatus(error)
          })
          return true
        }
      }
      logger.error('Error checking connection:', error as Error)
      throw error
    }
  }

  public createDirectory = async (directoryPath: string, options?: CreateDirectoryOptions) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteDirectoryPath = this.resolveRemoteDirectoryPath(directoryPath)

    try {
      return await this.instance.createDirectory(remoteDirectoryPath, options)
    } catch (error) {
      logger.error('Error creating directory on WebDAV:', error as Error)
      throw error
    }
  }

  public deleteFile = async (filename: string) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = this.resolveRemoteFilePath(filename)

    try {
      return await this.instance.deleteFile(remoteFilePath)
    } catch (error) {
      logger.error('Error deleting file on WebDAV:', error as Error)
      throw error
    }
  }
}
