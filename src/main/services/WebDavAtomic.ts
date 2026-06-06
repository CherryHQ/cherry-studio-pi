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
  maxVerifyBytes?: number
}

const MOVE_UNSUPPORTED_STATUSES = new Set([403, 405, 409, 501])
const MIN_REMOTE_JSON_VERIFY_MAX_BYTES = 1024 * 1024
const clientsWithoutMoveSupport = new WeakSet<WebDAVClient>()

class RemoteJsonVerificationSizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteJsonVerificationSizeError'
  }
}

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

function webDavBufferByteLength(value: string | Buffer | ArrayBuffer | unknown) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  if (Buffer.isBuffer(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  return Buffer.byteLength(String(value), 'utf8')
}

function assertRemoteJsonWithinVerifyLimit(
  value: string | Buffer | ArrayBuffer | unknown,
  filePath: string,
  options: WriteJsonOptions
) {
  const maxVerifyBytes = options.maxVerifyBytes
  if (!maxVerifyBytes) return

  const byteLength = webDavBufferByteLength(value)
  if (byteLength <= maxVerifyBytes) return

  throw new RemoteJsonVerificationSizeError(
    `远端 ${options.operation} ${filePath} 过大（${byteLength} 字节，限制 ${maxVerifyBytes} 字节），无法完成写入校验。为避免 WebDAV 同步占用过多内存，本次同步已停止。`
  )
}

async function assertRemoteJsonFileWithinVerifyLimit(
  client: WebDAVClient,
  filePath: string,
  options: WriteJsonOptions
) {
  const maxVerifyBytes = options.maxVerifyBytes
  if (!maxVerifyBytes) return

  const stat = (client as WebDAVClient & { stat?: (targetPath: string) => Promise<unknown> }).stat
  if (typeof stat !== 'function') return

  const result = await runWebDavOperation(
    `checking ${options.operation} verification size ${filePath}`,
    () => stat.call(client, filePath),
    {
      logger: options.logger,
      timeoutMs: options.timeoutMs
    }
  )
  const byteLength = Number((result as { size?: unknown } | null)?.size)
  if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength <= maxVerifyBytes) return

  throw new RemoteJsonVerificationSizeError(
    `远端 ${options.operation} ${filePath} 过大（${byteLength} 字节，限制 ${maxVerifyBytes} 字节），无法完成写入校验。为避免 WebDAV 同步占用过多内存，本次同步已停止。`
  )
}

async function readRemoteJsonHash(client: WebDAVClient, filePath: string, options: WriteJsonOptions) {
  await assertRemoteJsonFileWithinVerifyLimit(client, filePath, options)
  const contents = await runWebDavOperation(
    `verifying ${options.operation} ${filePath}`,
    () => client.getFileContents(filePath, { format: 'binary' }),
    { logger: options.logger, timeoutMs: options.timeoutMs }
  )
  assertRemoteJsonWithinVerifyLimit(contents, filePath, options)
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
    if (error instanceof RemoteJsonVerificationSizeError) {
      throw error
    }
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
  const content = JSON.stringify(data, null, 2)
  const verifyOptions: WriteJsonOptions = {
    ...options,
    maxVerifyBytes:
      options.maxVerifyBytes ?? Math.max(MIN_REMOTE_JSON_VERIFY_MAX_BYTES, Buffer.byteLength(content, 'utf8') * 2)
  }

  if (options.overwrite === false && (await verifyRemoteJsonHash(client, filePath, expectedHash, verifyOptions))) {
    return
  }

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

    if (!(await verifyRemoteJsonHash(client, temporaryPath, expectedHash, verifyOptions))) {
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

    if (!(await verifyRemoteJsonHash(client, filePath, expectedHash, verifyOptions))) {
      throw new Error(`Remote ${options.operation} final write verification failed: ${filePath}`)
    }
  } finally {
    await deleteRemoteFile(client, temporaryPath, options.logger)
  }
}
