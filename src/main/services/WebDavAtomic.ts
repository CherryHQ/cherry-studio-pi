import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import { runWebDavOperation, WebDavOperationError } from '@main/services/WebDavRetry'
import type { WebDAVClient } from 'webdav'

type WebDavAtomicLogger = {
  warn: (message: string, ...data: any[]) => void
}

type WriteJsonOptions = {
  logger: WebDavAtomicLogger
  operation: string
  overwrite?: boolean
  timeoutMs?: number
}

const MOVE_UNSUPPORTED_STATUSES = new Set([403, 405, 409, 501])
const clientsWithoutMoveSupport = new WeakSet<WebDAVClient>()

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalizeJson((value as Record<string, unknown>)[key])
      return result
    }, {})
}

export function hashJsonValue(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeJson(value)))
    .digest('hex')
}

export function webDavBufferToString(value: string | Buffer | ArrayBuffer | unknown) {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  return String(value)
}

async function readRemoteJsonHash(client: WebDAVClient, filePath: string, options: WriteJsonOptions) {
  const contents = await runWebDavOperation(
    `verifying ${options.operation} ${filePath}`,
    () => client.getFileContents(filePath, { format: 'binary' }),
    { logger: options.logger, timeoutMs: options.timeoutMs }
  )
  return hashJsonValue(JSON.parse(webDavBufferToString(contents)))
}

export async function verifyRemoteJsonHash(
  client: WebDAVClient,
  filePath: string,
  expectedHash: string,
  options: WriteJsonOptions
) {
  try {
    return (await readRemoteJsonHash(client, filePath, options)) === expectedHash
  } catch (error) {
    if (error instanceof WebDavOperationError && error.transient) {
      throw error
    }
    return false
  }
}

async function deleteRemoteFile(client: WebDAVClient, filePath: string, logger: WebDavAtomicLogger) {
  const deleteFile = (client as WebDAVClient & { deleteFile?: (targetPath: string) => Promise<void> }).deleteFile
  if (typeof deleteFile !== 'function') return

  await runWebDavOperation(`deleting temporary remote file ${filePath}`, () => deleteFile.call(client, filePath), {
    logger
  }).catch((error) => {
    if (error instanceof WebDavOperationError && error.status === 404) return
    logger.warn(`Failed to delete temporary remote file ${filePath}`, error as Error)
  })
}

async function promoteRemoteFile(
  client: WebDAVClient,
  temporaryPath: string,
  filePath: string,
  options: WriteJsonOptions
) {
  if (clientsWithoutMoveSupport.has(client)) return false

  const moveFile = (
    client as WebDAVClient & {
      moveFile?: (sourcePath: string, targetPath: string, options?: { overwrite?: boolean }) => Promise<void>
    }
  ).moveFile
  if (typeof moveFile !== 'function') return false

  try {
    await runWebDavOperation(
      `promoting ${options.operation} ${temporaryPath} to ${filePath}`,
      () => moveFile.call(client, temporaryPath, filePath, { overwrite: options.overwrite ?? true }),
      { logger: options.logger, timeoutMs: options.timeoutMs }
    )
    return true
  } catch (error) {
    if (error instanceof WebDavOperationError && error.status && MOVE_UNSUPPORTED_STATUSES.has(error.status)) {
      clientsWithoutMoveSupport.add(client)
      return false
    }
    options.logger.warn(`Failed to promote ${temporaryPath}; falling back to verified PUT`, error as Error)
    return false
  }
}

export async function writeWebDavJsonAtomically(
  client: WebDAVClient,
  filePath: string,
  data: unknown,
  options: WriteJsonOptions
) {
  const expectedHash = hashJsonValue(data)
  if (options.overwrite === false && (await verifyRemoteJsonHash(client, filePath, expectedHash, options))) {
    return
  }

  const content = JSON.stringify(data, null, 2)
  const temporaryPath = path.posix.join(
    path.posix.dirname(filePath),
    `.tmp-${path.posix.basename(filePath)}-${Date.now()}-${randomUUID()}.json`
  )

  try {
    await runWebDavOperation(
      `writing temporary ${options.operation} ${temporaryPath}`,
      () => client.putFileContents(temporaryPath, content, { overwrite: true }),
      { logger: options.logger, timeoutMs: options.timeoutMs }
    )

    if (!(await verifyRemoteJsonHash(client, temporaryPath, expectedHash, options))) {
      throw new Error(`Remote ${options.operation} temporary write verification failed: ${temporaryPath}`)
    }

    const promoted = await promoteRemoteFile(client, temporaryPath, filePath, options)
    if (!promoted) {
      const written = await runWebDavOperation(
        `writing verified ${options.operation} ${filePath}`,
        () => client.putFileContents(filePath, content, { overwrite: options.overwrite ?? true }),
        { logger: options.logger, timeoutMs: options.timeoutMs }
      )
      if (written === false && options.overwrite !== false) {
        throw new Error(`Remote ${options.operation} write was rejected: ${filePath}`)
      }
    }

    if (!(await verifyRemoteJsonHash(client, filePath, expectedHash, options))) {
      throw new Error(`Remote ${options.operation} final write verification failed: ${filePath}`)
    }
  } finally {
    await deleteRemoteFile(client, temporaryPath, options.logger)
  }
}
