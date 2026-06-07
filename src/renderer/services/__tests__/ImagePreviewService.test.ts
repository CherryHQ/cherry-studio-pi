import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImagePreviewService } from '../ImagePreviewService'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  svgToPngBlob: vi.fn(),
  svgToSvgBlob: vi.fn(),
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  },
  ImageViewer: vi.fn(() => null),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn()
}))

vi.mock('@renderer/utils/image', () => ({
  svgToPngBlob: mocks.svgToPngBlob,
  svgToSvgBlob: mocks.svgToSvgBlob
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.TopView
}))

vi.mock('@renderer/components/ImageViewer', () => ({
  default: mocks.ImageViewer
}))

// Mock URL.createObjectURL and URL.revokeObjectURL
Object.assign(global.URL, {
  createObjectURL: mocks.createObjectURL,
  revokeObjectURL: mocks.revokeObjectURL
})

describe('ImagePreviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createObjectURL.mockReturnValue('blob:mock-url')
  })

  afterEach(() => {
    vi.clearAllMocks()
    ;(ImagePreviewService as any).currentObjectUrl = undefined
  })

  describe('show', () => {
    it('should handle SVG element input with PNG format', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const mockBlob = new Blob(['mock'], { type: 'image/png' })

      mocks.svgToPngBlob.mockResolvedValue(mockBlob)

      await ImagePreviewService.show(mockSvgElement, { format: 'png', scale: 2 })

      expect(mocks.svgToPngBlob).toHaveBeenCalledWith(mockSvgElement, 2)
      expect(mocks.createObjectURL).toHaveBeenCalledWith(mockBlob)
      expect(mocks.TopView.show).toHaveBeenCalledWith(expect.any(Function), 'image-preview')
    })

    it('should handle SVG element input with SVG format', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const mockBlob = new Blob(['mock'], { type: 'image/svg+xml' })

      mocks.svgToSvgBlob.mockReturnValue(mockBlob)

      await ImagePreviewService.show(mockSvgElement, { format: 'svg' })

      expect(mocks.svgToSvgBlob).toHaveBeenCalledWith(mockSvgElement)
      expect(mocks.createObjectURL).toHaveBeenCalledWith(mockBlob)
      expect(mocks.TopView.show).toHaveBeenCalled()
    })

    it('should handle string URL input', async () => {
      const imageUrl = 'https://example.com/image.png'

      await ImagePreviewService.show(imageUrl)

      expect(mocks.TopView.show).toHaveBeenCalled()
      expect(mocks.createObjectURL).not.toHaveBeenCalled()
    })

    it('should handle Blob input', async () => {
      const mockBlob = new Blob(['mock'], { type: 'image/png' })

      await ImagePreviewService.show(mockBlob)

      expect(mocks.createObjectURL).toHaveBeenCalledWith(mockBlob)
      expect(mocks.TopView.show).toHaveBeenCalled()
    })

    it('should revoke created blob URLs when preview closes', async () => {
      const mockBlob = new Blob(['mock'], { type: 'image/png' })

      await ImagePreviewService.show(mockBlob)

      const previewFactory = mocks.TopView.show.mock.calls[0][0] as () => any
      const element = previewFactory()
      element.props.preview.onVisibleChange(false)

      expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(mocks.TopView.hide).toHaveBeenCalledWith('image-preview')
    })

    it('should replace an existing preview and revoke the previous blob URL', async () => {
      const firstBlob = new Blob(['first'], { type: 'image/png' })
      const secondBlob = new Blob(['second'], { type: 'image/png' })
      mocks.createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')

      await ImagePreviewService.show(firstBlob)
      await ImagePreviewService.show(secondBlob)

      expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:first')
      expect(mocks.revokeObjectURL).not.toHaveBeenCalledWith('blob:second')
      expect(mocks.TopView.hide).toHaveBeenCalledWith('image-preview')
      expect(mocks.TopView.show).toHaveBeenCalledTimes(2)
    })

    it('should revoke created blob URLs when preview setup fails', async () => {
      const mockBlob = new Blob(['mock'], { type: 'image/png' })
      const error = new Error('preview failed')
      mocks.TopView.show.mockImplementationOnce(() => {
        throw error
      })

      await expect(ImagePreviewService.show(mockBlob)).rejects.toThrow(error)

      expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('should handle HTMLImageElement input', async () => {
      const mockImg = document.createElement('img')
      mockImg.src = 'https://example.com/image.png'

      await ImagePreviewService.show(mockImg)

      expect(mocks.TopView.show).toHaveBeenCalled()
      expect(mocks.createObjectURL).not.toHaveBeenCalled()
    })

    it('should throw error for unsupported input type', async () => {
      const unsupportedInput = { invalid: 'input' } as any

      await expect(ImagePreviewService.show(unsupportedInput)).rejects.toThrow('Unsupported input type')
    })

    it('should use default scale when not provided', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const mockBlob = new Blob(['mock'], { type: 'image/png' })

      mocks.svgToPngBlob.mockResolvedValue(mockBlob)

      await ImagePreviewService.show(mockSvgElement)

      expect(mocks.svgToPngBlob).toHaveBeenCalledWith(mockSvgElement, 3) // default scale
    })
  })
})
