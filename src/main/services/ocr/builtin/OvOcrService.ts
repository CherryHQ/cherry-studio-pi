import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { isImageFileMetadata } from '@shared/data/types/legacyFile'
import type { OcrOvConfig, OcrResult, SupportedOcrFile } from '@shared/types/ocr'
import { execFile, type ExecFileOptions } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { OcrBaseService } from './OcrBaseService'

const logger = loggerService.withContext('OvOcrService')

function runBatchFile(filePath: string, options: ExecFileOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('cmd.exe', ['/d', '/s', '/c', `"${filePath}"`], { windowsHide: true, ...options }, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

export class OvOcrService extends OcrBaseService {
  constructor() {
    super()
  }

  public isAvailable(): boolean {
    return (
      isWin &&
      os.cpus()[0].model.toLowerCase().includes('intel') &&
      os.cpus()[0].model.toLowerCase().includes('ultra') &&
      fs.existsSync(application.getPath('feature.ovms.ovocr', 'run.npu.bat'))
    )
  }

  private getImgDir(workingDirectory: string): string {
    return path.join(workingDirectory, 'img')
  }

  private getOutputDir(workingDirectory: string): string {
    return path.join(workingDirectory, 'output')
  }

  private async prepareDirectory(dirPath: string): Promise<void> {
    await fs.promises.rm(dirPath, { recursive: true, force: true })
    await fs.promises.mkdir(dirPath, { recursive: true })
  }

  private async copyFileToImgDir(
    sourceFilePath: string,
    targetFileName: string,
    workingDirectory: string
  ): Promise<void> {
    const imgDir = this.getImgDir(workingDirectory)
    const targetFilePath = path.join(imgDir, targetFileName)
    await fs.promises.copyFile(sourceFilePath, targetFilePath)
  }

  private async runOcrBatch(workingDirectory: string): Promise<void> {
    try {
      await runBatchFile(application.getPath('feature.ovms.ovocr', 'run.npu.bat'), {
        cwd: workingDirectory,
        timeout: 60000 // 60 second timeout
      })
    } catch (error) {
      logger.error(`Error running ovocr batch: ${error}`)
      throw new Error(`Failed to run OCR batch: ${error}`)
    }
  }

  private getWorkingDirectoryPrefix(): string {
    try {
      return path.join(application.getPath('app.temp'), 'cherry-ovocr-')
    } catch {
      return path.join(os.tmpdir(), 'cherry-ovocr-')
    }
  }

  private async createWorkingDirectory(): Promise<string> {
    const preferredPrefix = this.getWorkingDirectoryPrefix()
    try {
      await fs.promises.mkdir(path.dirname(preferredPrefix), { recursive: true })
      return await fs.promises.mkdtemp(preferredPrefix)
    } catch (error) {
      const fallbackPrefix = path.join(os.tmpdir(), 'cherry-ovocr-')
      logger.warn(
        'Failed to create OV OCR working directory under app temp; falling back to system temp',
        error as Error
      )
      await fs.promises.mkdir(path.dirname(fallbackPrefix), { recursive: true })
      return fs.promises.mkdtemp(fallbackPrefix)
    }
  }

  private async ocrImage(filePath: string, options?: OcrOvConfig): Promise<OcrResult> {
    logger.info('OV OCR called', {
      options: options ? { keys: Object.keys(options) } : undefined
    })

    let workingDirectory: string | null = null
    try {
      workingDirectory = await this.createWorkingDirectory()
      await this.prepareDirectory(this.getImgDir(workingDirectory))
      await this.prepareDirectory(this.getOutputDir(workingDirectory))

      const fileName = path.basename(filePath)
      await this.copyFileToImgDir(filePath, fileName, workingDirectory)
      logger.info('OV OCR input copied to isolated working directory', {
        extension: path.extname(fileName).toLowerCase()
      })

      logger.info('Running OV OCR batch process...')
      await this.runOcrBatch(workingDirectory)

      const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
      const outputFilePath = path.join(this.getOutputDir(workingDirectory), `${baseNameWithoutExt}.txt`)
      if (!fs.existsSync(outputFilePath)) {
        throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
      }

      const ocrText = await fs.promises.readFile(outputFilePath, 'utf-8')
      logger.info('OV OCR text extracted', {
        text: { length: ocrText.length }
      })

      return { text: ocrText }
    } catch (error) {
      logger.error(`Error during OV OCR process: ${error}`)
      throw error
    } finally {
      if (workingDirectory) {
        await fs.promises.rm(workingDirectory, { recursive: true, force: true })
      }
    }
  }

  public ocr = async (file: SupportedOcrFile, options?: OcrOvConfig): Promise<OcrResult> => {
    if (isImageFileMetadata(file)) {
      return this.ocrImage(file.path, options)
    } else {
      throw new Error('Unsupported file type, currently only image files are supported')
    }
  }
}

export const ovOcrService = new OvOcrService()
