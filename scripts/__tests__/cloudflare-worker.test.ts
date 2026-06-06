import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type StoredR2Object = {
  body: ArrayBuffer | string
  size: number
  httpMetadata?: Record<string, string>
}

class FakeR2Bucket {
  readonly objects = new Map<string, StoredR2Object>()
  readonly deleted: string[] = []

  constructor(initialObjects: Record<string, StoredR2Object | string> = {}) {
    for (const [key, value] of Object.entries(initialObjects)) {
      if (typeof value === 'string') {
        this.objects.set(key, { body: value, size: Buffer.byteLength(value) })
      } else {
        this.objects.set(key, value)
      }
    }
  }

  async get(key: string) {
    const object = this.objects.get(key)
    if (!object) {
      return null
    }

    return {
      size: object.size,
      httpEtag: `"${key}"`,
      writeHttpMetadata(headers: Headers) {
        if (object.httpMetadata?.contentType) {
          headers.set('Content-Type', object.httpMetadata.contentType)
        }
      },
      text: async () => (typeof object.body === 'string' ? object.body : Buffer.from(object.body).toString('utf8')),
      arrayBuffer: async () => (typeof object.body === 'string' ? Buffer.from(object.body).buffer : object.body),
      body: object.body
    }
  }

  async put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: Record<string, string> }) {
    const body = typeof value === 'string' ? value : value.slice(0)
    const size = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
    this.objects.set(key, {
      body,
      size,
      httpMetadata: options?.httpMetadata
    })
  }

  async delete(key: string) {
    this.deleted.push(key)
    this.objects.delete(key)
  }

  async list() {
    return {
      objects: Array.from(this.objects.entries()).map(([name, object]) => ({
        name,
        size: object.size
      })),
      cursor: undefined
    }
  }
}

describe('cloudflare-worker', () => {
  const originalFetch = globalThis.fetch
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
    vi.resetModules()
  })

  it('refreshes the release cache without deleting worker metadata', async () => {
    const releaseAssetName = 'CherryStudioPi-1.0.2-x86_64.AppImage'
    const releaseAsset = new Uint8Array([1, 2, 3, 4]).buffer
    const bucket = new FakeR2Bucket({
      'versions.json': JSON.stringify({
        versions: {
          'v1.0.0': {
            version: 'v1.0.0',
            files: [{ name: 'old-release.dmg', uploaded: true }]
          },
          'v1.0.1': {
            version: 'v1.0.1',
            files: [{ name: 'kept-release.dmg', uploaded: true }]
          }
        },
        latestVersion: 'v1.0.1',
        lastChecked: new Date(0).toISOString()
      }),
      'logs.json': JSON.stringify({ logs: [] }),
      'cherry-studio-pi-latest-release': JSON.stringify({ version: 'v1.0.1' }),
      'old-release.dmg': { body: 'old', size: 3 },
      'kept-release.dmg': { body: 'kept', size: 4 },
      'orphan.tmp': { body: 'orphan', size: 6 }
    })

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url.includes('api.github.com')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v1.0.2',
            published_at: '2026-06-06T00:00:00.000Z',
            body: 'Release notes',
            assets: [
              {
                name: releaseAssetName,
                size: releaseAsset.byteLength,
                browser_download_url: 'https://downloads.example.com/CherryStudioPi.AppImage'
              }
            ]
          }),
          { status: 200 }
        )
      }

      return new Response(releaseAsset, { status: 200 })
    }) as typeof fetch

    const { default: worker } = await import('../cloudflare-worker.js')

    await worker.scheduled({}, { R2_BUCKET: bucket }, {})

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(bucket.objects.has('versions.json')).toBe(true)
    expect(bucket.objects.has('logs.json')).toBe(true)
    expect(bucket.objects.has('cherry-studio-pi-latest-release')).toBe(true)
    expect(bucket.objects.has('orphan.tmp')).toBe(false)
    expect(bucket.objects.get(releaseAssetName)?.httpMetadata?.contentType).toBe('application/x-executable')
  })
})
