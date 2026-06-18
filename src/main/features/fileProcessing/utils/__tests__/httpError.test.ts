import { describe, expect, it } from 'vitest'

import { readResponseBodyPreview } from '../httpError'

describe('fileProcessing http error utils', () => {
  it('reads small response bodies as a trimmed preview', async () => {
    const response = new Response('  provider failed  ')

    await expect(readResponseBodyPreview(response, 100)).resolves.toBe('provider failed')
  })

  it('truncates oversized response bodies without reading the full text', async () => {
    const response = new Response('x'.repeat(32))

    await expect(readResponseBodyPreview(response, 8)).resolves.toBe('xxxxxxxx... [truncated]')
  })

  it('returns an empty preview for responses without a body', async () => {
    const response = new Response(null)

    await expect(readResponseBodyPreview(response, 8)).resolves.toBe('')
  })
})
