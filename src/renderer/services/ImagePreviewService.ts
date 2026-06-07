import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { svgToPngBlob, svgToSvgBlob } from '@renderer/utils/image'
import React from 'react'

const logger = loggerService.withContext('ImagePreviewService')

export type ImageInput = SVGElement | HTMLImageElement | string | Blob

export interface ImagePreviewOptions {
  format?: 'svg' | 'png' | 'jpeg'
  scale?: number
  quality?: number
}

/**
 * 图像预览服务
 * 提供统一的图像预览功能，支持多种输入类型
 */
export class ImagePreviewService {
  private static currentObjectUrl: string | undefined

  private static rememberObjectUrl(url: string) {
    if (url.startsWith('blob:')) {
      this.currentObjectUrl = url
    } else {
      this.currentObjectUrl = undefined
    }
  }

  private static revokeObjectUrl(url: string | undefined) {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url)
      if (this.currentObjectUrl === url) {
        this.currentObjectUrl = undefined
      }
    }
  }

  private static closeCurrentPreview() {
    this.revokeObjectUrl(this.currentObjectUrl)
    TopView.hide('image-preview')
  }

  /**
   * 显示图像预览
   * @param input 图像输入源
   * @param options 预览选项
   */
  static async show(input: ImageInput, options: ImagePreviewOptions = {}): Promise<void> {
    let imageUrl: string | undefined
    try {
      const processedImageUrl = await this.processInput(input, options)
      imageUrl = processedImageUrl

      // 动态导入 ImageViewer 避免循环依赖
      const { default: ImageViewer } = await import('@renderer/components/ImageViewer')

      const handleVisibilityChange = (visible: boolean) => {
        if (!visible) {
          this.revokeObjectUrl(processedImageUrl)
          TopView.hide('image-preview')
        }
      }

      this.closeCurrentPreview()
      this.rememberObjectUrl(processedImageUrl)

      TopView.show(
        () =>
          React.createElement(ImageViewer, {
            src: processedImageUrl,
            style: { display: 'none' }, // 隐藏图片本身，只显示预览对话框
            preview: {
              visible: true,
              onVisibleChange: handleVisibilityChange
            }
          }),
        'image-preview'
      )
    } catch (error) {
      this.revokeObjectUrl(imageUrl)
      logger.error('Failed to show image preview:', error as Error)
      throw error
    }
  }

  /**
   * 处理输入并转换为可预览的 URL
   * @param input 图像输入源
   * @param options 处理选项
   * @returns 图像 URL
   */
  private static async processInput(input: ImageInput, options: ImagePreviewOptions): Promise<string> {
    if (input instanceof SVGElement) {
      const blob = options.format === 'svg' ? svgToSvgBlob(input) : await svgToPngBlob(input, options.scale || 3)
      return URL.createObjectURL(blob)
    }

    if (input instanceof HTMLImageElement) {
      return input.src
    }

    if (typeof input === 'string') {
      return input
    }

    if (input instanceof Blob) {
      return URL.createObjectURL(input)
    }

    throw new Error('Unsupported input type')
  }
}
