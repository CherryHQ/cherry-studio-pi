import http from 'node:http'
import https from 'node:https'

import { describe, expect, it } from 'vitest'

import { createWebDavClientOptions } from '../WebDavClientOptions'

describe('WebDavClientOptions', () => {
  it('builds consistent WebDAV client options for HTTP and HTTPS servers', () => {
    const options = createWebDavClientOptions({
      username: 'webdav',
      password: 'pass'
    })

    expect(options).toMatchObject({
      username: 'webdav',
      password: 'pass',
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })
    expect(options.httpAgent).toBeInstanceOf(http.Agent)
    expect(options.httpsAgent).toBeInstanceOf(https.Agent)
    expect((options.httpAgent as http.Agent & { options: http.AgentOptions }).options).toMatchObject({
      keepAlive: true,
      keepAliveMsecs: 10_000,
      maxSockets: 8,
      maxFreeSockets: 4
    })
    expect((options.httpsAgent as https.Agent).options.rejectUnauthorized).toBe(false)
    expect((options.httpsAgent as https.Agent & { options: https.AgentOptions }).options).toMatchObject({
      keepAlive: true,
      keepAliveMsecs: 10_000,
      maxSockets: 8,
      maxFreeSockets: 4
    })
  })

  it('reuses keep-alive agents across WebDAV clients', () => {
    const first = createWebDavClientOptions({ username: 'webdav', password: 'first' })
    const second = createWebDavClientOptions({ username: 'webdav', password: 'second' })

    expect(second.httpAgent).toBe(first.httpAgent)
    expect(second.httpsAgent).toBe(first.httpsAgent)
    expect(second.password).toBe('second')
  })
})
