import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getImageInfo } from '../imageUtils'

const originalImage = globalThis.Image

describe('RichEditor imageUtils', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Image',
      class MockImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        width = 640
        height = 360

        set src(value: string) {
          if (value.includes('fail')) {
            queueMicrotask(() => this.onerror?.())
            return
          }

          queueMicrotask(() => this.onload?.())
        }
      }
    )
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:rich-editor-image'),
      revokeObjectURL: vi.fn()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.Image = originalImage
  })

  it('revokes the temporary object URL after reading image info', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' })

    await expect(getImageInfo(file)).resolves.toMatchObject({
      width: 640,
      height: 360,
      size: file.size,
      type: 'image/png'
    })

    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rich-editor-image')
  })
})
