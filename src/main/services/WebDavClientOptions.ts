import http from 'node:http'
import https from 'node:https'

import type { WebDAVClientOptions } from 'webdav'

const WEBDAV_AGENT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 8,
  maxFreeSockets: 4
} as const

const sharedHttpAgent = new http.Agent(WEBDAV_AGENT_OPTIONS)
const sharedHttpsAgent = new https.Agent({ ...WEBDAV_AGENT_OPTIONS, rejectUnauthorized: false })

export function createWebDavClientOptions(
  options: Pick<WebDAVClientOptions, 'username' | 'password'> = {}
): WebDAVClientOptions {
  return {
    ...options,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    httpAgent: sharedHttpAgent,
    httpsAgent: sharedHttpsAgent
  }
}
