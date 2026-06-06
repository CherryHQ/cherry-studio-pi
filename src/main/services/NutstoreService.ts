import path from 'node:path'

import { loggerService } from '@logger'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'
import { isNil } from 'lodash'
import { type FileStat } from 'webdav'

import { createOAuthUrl, decryptSecret } from '../integration/nutstore/sso/lib/index.mjs'

const logger = loggerService.withContext('NutstoreService')

interface OAuthResponse {
  username: string
  userid: string
  access_token: string
}

interface WebDAVPropStat {
  prop?: {
    displayname?: string
    resourcetype?: { collection?: any }
    getlastmodified?: string
    getcontentlength?: string
    getcontenttype?: string
  }
  status?: string
}

interface WebDAVResponseItem {
  href?: string
  propstat?: WebDAVPropStat | WebDAVPropStat[]
}

interface WebDAVResponse {
  multistatus: {
    response?: WebDAVResponseItem | WebDAVResponseItem[]
  }
}

export async function getNutstoreSSOUrl() {
  return await createOAuthUrl({
    app: 'cherrystudio'
  })
}

export async function decryptToken(token: string) {
  try {
    const decrypted = await decryptSecret({
      app: 'cherrystudio',
      s: token
    })
    return JSON.parse(decrypted) as OAuthResponse
  } catch (error) {
    logger.error('Failed to decrypt token:', error as Error)
    return null
  }
}

export async function getDirectoryContents(token: string, target: string): Promise<FileStat[]> {
  const contents: FileStat[] = []
  if (!target.startsWith('/')) {
    target = '/' + target
  }

  let currentUrl = encodeURI(`${NUTSTORE_HOST}${target}`)

  while (true) {
    const response = await net.fetch(currentUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/xml',
        Depth: '1'
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <propfind xmlns="DAV:">
          <prop>
            <displayname/>
            <resourcetype/>
            <getlastmodified/>
            <getcontentlength/>
            <getcontenttype/>
          </prop>
        </propfind>`
    })

    const text = await response.text()
    const status = response.status ?? 200
    if (status < 200 || status >= 300) {
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      const bodyPreview = text.trim().slice(0, 160)
      throw new Error(`Nutstore request failed: ${status}${statusText}${bodyPreview ? `: ${bodyPreview}` : ''}`)
    }

    const result = parseXml<WebDAVResponse>(text)
    const items = toArray(result.multistatus?.response)

    // 跳过第一个条目（当前目录）
    contents.push(
      ...items
        .slice(1)
        .map((item) => convertToFileStat('/dav', item))
        .filter(isFileStat)
    )

    const linkHeader = response.headers.get('link')
    if (!linkHeader) {
      break
    }

    const nextLink = extractNextLink(linkHeader)
    if (!nextLink) {
      break
    }

    currentUrl = resolveNextUrl(nextLink, currentUrl)
  }

  return contents
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function extractNextLink(linkHeader: string): string | null {
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return matches ? matches[1] : null
}

function safeDecodeUri(value: string) {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveNextUrl(nextLink: string, currentUrl: string) {
  const decoded = safeDecodeUri(nextLink)
  try {
    return new URL(decoded, currentUrl).toString()
  } catch {
    return decoded
  }
}

function selectPropStat(propstat: WebDAVResponseItem['propstat']) {
  const propstats = toArray(propstat)
  return propstats.find((item) => item.status?.includes(' 200 ')) ?? propstats[0]
}

function isFileStat(value: FileStat | null): value is FileStat {
  return value !== null
}

function convertToFileStat(serverBase: string, item: WebDAVResponseItem): FileStat | null {
  if (!item.href) return null

  const props = selectPropStat(item.propstat)?.prop ?? {}
  const isDir = !isNil(props.resourcetype?.collection)
  const href = safeDecodeURIComponent(item.href)
  const relativeHref = serverBase === '/' || !href.startsWith(serverBase) ? href : href.slice(serverBase.length)
  const filename = serverBase === '/' ? href : path.posix.join('/', relativeHref)
  const size = props.getcontentlength ? parseInt(props.getcontentlength, 10) : 0

  return {
    filename: filename.endsWith('/') ? filename.slice(0, -1) : filename,
    basename: path.basename(filename),
    lastmod: props.getlastmodified || '',
    size: Number.isFinite(size) ? size : 0,
    type: isDir ? 'directory' : 'file',
    etag: null,
    mime: props.getcontenttype
  }
}

function parseXml<T>(xml: string) {
  const parser = new XMLParser({
    attributeNamePrefix: '',
    removeNSPrefix: true
  })
  return parser.parse(xml) as T
}
