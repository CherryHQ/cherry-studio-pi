import { allFilesExt } from '@shared/config/constant'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  filterSupportedFiles,
  formatFileSize,
  getFileDirectory,
  getFileExtension,
  isSupportedFile,
  removeSpecialCharactersForFileName
} from '../file'

const originalApiDescriptor = Object.getOwnPropertyDescriptor(window, 'api')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalApiDescriptor) {
    Object.defineProperty(window, 'api', originalApiDescriptor)
  } else {
    delete (window as unknown as { api?: unknown }).api
  }
})

describe('file', () => {
  describe('getFileDirectory', () => {
    it('should return directory path for normal file path', () => {
      // 验证普通文件路径的目录提取
      const filePath = 'path/to/file.txt'
      const result = getFileDirectory(filePath)
      expect(result).toBe('path/to')
    })

    it('should return empty string for file without directory', () => {
      // 验证没有目录的文件路径
      const filePath = 'file.txt'
      const result = getFileDirectory(filePath)
      expect(result).toBe('')
    })

    it('should handle absolute path correctly', () => {
      // 验证绝对路径的目录提取
      const filePath = '/root/path/to/file.txt'
      const result = getFileDirectory(filePath)
      expect(result).toBe('/root/path/to')
    })

    it('should handle empty string input', () => {
      // 验证空字符串输入的边界情况
      const filePath = ''
      const result = getFileDirectory(filePath)
      expect(result).toBe('')
    })
  })

  describe('getFileExtension', () => {
    it('should return lowercase extension for normal file', () => {
      // 验证普通文件的扩展名提取
      const filePath = 'document.pdf'
      const result = getFileExtension(filePath)
      expect(result).toBe('.pdf')
    })

    it('should convert uppercase extension to lowercase', () => {
      // 验证大写扩展名转换为小写
      const filePath = 'image.PNG'
      const result = getFileExtension(filePath)
      expect(result).toBe('.png')
    })

    it('should return dot only for file without extension', () => {
      // 验证没有扩展名的文件
      const filePath = 'noextension'
      const result = getFileExtension(filePath)
      expect(result).toBe('.')
    })

    it('should handle hidden files with extension', () => {
      // 验证带有扩展名的隐藏文件
      const filePath = '.config.json'
      const result = getFileExtension(filePath)
      expect(result).toBe('.json')
    })

    it('should ignore dots in parent directories', () => {
      const filePath = '/tmp/cherry.workspace/noextension'
      const result = getFileExtension(filePath)
      expect(result).toBe('.')
    })

    it('should handle Windows paths correctly', () => {
      const filePath = 'C:\\Users\\Cherry.Workspace\\image.PNG'
      const result = getFileExtension(filePath)
      expect(result).toBe('.png')
    })

    it('should handle empty string input', () => {
      // 验证空字符串输入的边界情况
      const filePath = ''
      const result = getFileExtension(filePath)
      expect(result).toBe('.')
    })
  })

  describe('formatFileSize', () => {
    it('should format size in MB for large files', () => {
      // 验证大文件以 MB 为单位格式化
      const size = 1048576 // 1MB
      const result = formatFileSize(size)
      expect(result).toBe('1.0 MB')
    })

    it('should format size in KB for medium files', () => {
      // 验证中等大小文件以 KB 为单位格式化
      const size = 1024 // 1KB
      const result = formatFileSize(size)
      expect(result).toBe('1 KB')
    })

    it('should format small size in KB with decimals', () => {
      // 验证小文件以 KB 为单位并带小数
      const size = 500
      const result = formatFileSize(size)
      expect(result).toBe('0.49 KB')
    })

    it('should handle zero size', () => {
      // 验证零大小的边界情况
      const size = 0
      const result = formatFileSize(size)
      expect(result).toBe('0.00 KB')
    })
  })

  describe('isSupportedFile', () => {
    it('accepts any file when allFilesExt is present', async () => {
      const isTextFile = vi.fn(async () => false)
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { file: { isTextFile } }
      })

      await expect(isSupportedFile('/tmp/archive.unknown-binary', new Set([allFilesExt]))).resolves.toBe(true)

      expect(isTextFile).not.toHaveBeenCalled()
    })

    it('keeps all files during filtering when allFilesExt is present', async () => {
      const isTextFile = vi.fn(async () => false)
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { file: { isTextFile } }
      })
      const files = [{ path: '/tmp/asset.bin' }, { path: '/tmp/no-extension' }] as unknown as Parameters<
        typeof filterSupportedFiles
      >[0]

      await expect(filterSupportedFiles(files, [allFilesExt])).resolves.toEqual(files)

      expect(isTextFile).not.toHaveBeenCalled()
    })
  })

  describe('removeSpecialCharactersForFileName', () => {
    it('should remove invalid characters for filename', () => {
      // 验证移除文件名中的非法字符
      expect(removeSpecialCharactersForFileName('Hello:<>World\nTest')).toBe('Hello___World Test')
    })

    it('should return original string if no invalid characters', () => {
      // 验证没有非法字符的字符串
      expect(removeSpecialCharactersForFileName('HelloWorld')).toBe('HelloWorld')
    })

    it('should return empty string for empty input', () => {
      // 验证空字符串
      expect(removeSpecialCharactersForFileName('')).toBe('')
    })
  })
})
