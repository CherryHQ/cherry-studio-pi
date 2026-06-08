import http from 'node:http'
import https from 'node:https'

import type { WebDAVClientOptions } from 'webdav'

export function createWebDavClientOptions(
  options: Pick<WebDAVClientOptions, 'username' | 'password'> = {}
): WebDAVClientOptions {
  return {
    ...options,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    httpAgent: new http.Agent(),
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  }
}
