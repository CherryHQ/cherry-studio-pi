import { loggerService } from '@logger'
import i18n from '@renderer/i18n'

const logger = loggerService.withContext('Utils:download')
const OBJECT_URL_REVOKE_DELAY_MS = 1000
const REMOTE_DOWNLOAD_TIMEOUT_MS = 30_000

export const revokeObjectUrlLater = (url: string) => {
  const timer = setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
  const maybeNodeTimer = timer as { unref?: () => void }
  maybeNodeTimer.unref?.()
}

const showDownloadError = (error: unknown) => {
  logger.error('Download failed:', error as Error)
  // 显示用户友好的错误提示
  if (error instanceof Error && error.message) {
    window.toast?.error(`${i18n.t('message.download.failed')}：${error.message}`)
  } else {
    window.toast?.error(i18n.t('message.download.failed'))
  }
}

export const download = (url: string, filename?: string) => {
  // 处理可直接通过 <a> 标签下载的 URL:
  // - 本地文件 ( file:// )
  // - 对象 URL ( blob: )
  // - 相对安全的内联数据 ( data:image/png, data:image/jpeg )
  //   (注: 其他 data 类型，如 data:text/html 或 data:image/svg+xml，
  //    因其潜在安全风险，不在此处理，将由后续 fetch 逻辑处理或被 CSP 阻止。)
  const SUPPORTED_PREFIXES = ['file://', 'blob:', 'data:image/png', 'data:image/jpeg']
  if (SUPPORTED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = resolveDirectDownloadFilename(url, filename)

      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error) {
      showDownloadError(error)
    }
    return
  }

  // 处理普通 URL
  fetch(url, { signal: AbortSignal.timeout(REMOTE_DOWNLOAD_TIMEOUT_MS) })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      let finalFilename = filename || 'download'

      if (!filename) {
        // 尝试从Content-Disposition头获取文件名
        finalFilename = getFilenameFromContentDisposition(response.headers.get('Content-Disposition')) || finalFilename

        // 如果URL中有文件名，使用URL中的文件名
        const urlFilename = getFilenameFromUrl(url)
        if (urlFilename && urlFilename.includes('.')) {
          finalFilename = urlFilename
        }

        // 如果文件名没有后缀，根据Content-Type添加后缀
        if (!finalFilename.includes('.')) {
          const contentType = response.headers.get('Content-Type')
          const extension = getExtensionFromMimeType(contentType)
          finalFilename += extension
        }

        // 添加时间戳以确保文件名唯一
        finalFilename = `${Date.now()}_${finalFilename}`
      }

      return response.blob().then((blob) => ({ blob, finalFilename }))
    })
    .then(({ blob, finalFilename }) => {
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = blobUrl
        link.download = finalFilename
        document.body.appendChild(link)
        link.click()
      } finally {
        revokeObjectUrlLater(blobUrl)
        link.remove()
      }
    })
    .catch((error) => {
      showDownloadError(error)
    })
}

function resolveDirectDownloadFilename(url: string, filename?: string): string {
  if (filename) return filename

  if (url.startsWith('file://')) {
    return getFilenameFromFileUrl(url) || 'download'
  }
  if (url.startsWith('blob:')) {
    return `${Date.now()}_diagram.svg`
  }
  if (url.startsWith('data:')) {
    const mimeMatch = url.match(/^data:([^;,]+)[;,]/)
    const mimeType = mimeMatch && mimeMatch[1]
    const extension = getExtensionFromMimeType(mimeType)
    return `${Date.now()}_download${extension}`
  }

  return 'download'
}

function getFilenameFromFileUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const encodedFilename = pathname.substring(pathname.lastIndexOf('/') + 1)
    if (!encodedFilename) return ''

    return safeDecodeURIComponent(encodedFilename)
  } catch {
    return ''
  }
}

function getFilenameFromContentDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    return safeDecodeURIComponent(encodedMatch[1].trim())
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim()
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i)
  if (plainMatch?.[1]) {
    return plainMatch[1].trim().replace(/^"|"$/g, '')
  }

  return undefined
}

function getFilenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname
    const encodedFilename = pathname.substring(pathname.lastIndexOf('/') + 1)
    return encodedFilename ? safeDecodeURIComponent(encodedFilename) : undefined
  } catch {
    const fallback = url.split(/[?#]/)[0]?.split('/').pop()
    return fallback ? safeDecodeURIComponent(fallback) : undefined
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// 辅助函数：根据MIME类型获取文件扩展名
function getExtensionFromMimeType(mimeType: string | null): string {
  if (!mimeType) return '.bin' // 默认二进制文件扩展名

  const mimeToExtension: { [key: string]: string } = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
  }

  return mimeToExtension[mimeType] || '.bin'
}
