import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { summarizeObjectShapeForLog, summarizeTextForLog } from '@main/utils/logging'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import type { OcrOvConfig, OcrResult, SupportedOcrFile } from '@types'
import { isImageFileMetadata } from '@types'
import { execFile, type ExecFileOptions } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { OcrBaseService } from './OcrBaseService'

const logger = loggerService.withContext('OvOcrService')

const PATH_BAT_FILE = path.join(os.homedir(), HOME_CHERRY_DIR, 'ovms', 'ovocr', 'run.npu.bat')

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
    const cpuModel = os.cpus()[0]?.model.toLowerCase() ?? ''
    return isWin && cpuModel.includes('intel') && cpuModel.includes('ultra') && fs.existsSync(PATH_BAT_FILE)
  }

  private async copyFileToImgDir(imgDir: string, sourceFilePath: string, targetFileName: string): Promise<void> {
    const targetFilePath = path.join(imgDir, targetFileName)
    await fs.promises.copyFile(sourceFilePath, targetFilePath)
  }

  private async runOcrBatch(workingDirectory: string): Promise<void> {
    try {
      // The batch reads ./img and writes ./output relative to cwd, so each OCR
      // request gets an isolated temporary working directory.
      await runBatchFile(PATH_BAT_FILE, {
        cwd: workingDirectory,
        timeout: 60000 // 60 second timeout
      })
    } catch (error) {
      logger.error(`Error running ovocr batch: ${error}`)
      throw new Error(`Failed to run OCR batch: ${error}`)
    }
  }

  private async ocrImage(filePath: string, options?: OcrOvConfig): Promise<OcrResult> {
    logger.info('OV OCR called', {
      extension: path.extname(filePath).toLowerCase(),
      filePath: summarizeTextForLog(filePath),
      options: summarizeObjectShapeForLog(options)
    })

    let workingDirectory: string | null = null

    try {
      workingDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cherry-ovocr-'))
      const imgDir = path.join(workingDirectory, 'img')
      const outputDir = path.join(workingDirectory, 'output')

      // 1. Create isolated img and output directories for this request
      await fs.promises.mkdir(imgDir, { recursive: true })
      await fs.promises.mkdir(outputDir, { recursive: true })

      // 2. Copy file to img directory
      const fileName = path.basename(filePath)
      await this.copyFileToImgDir(imgDir, filePath, fileName)
      logger.info('File copied to OV OCR img directory', {
        extension: path.extname(fileName).toLowerCase(),
        fileName: summarizeTextForLog(fileName)
      })

      // 3. Run run.bat
      logger.info('Running OV OCR batch process...')
      await this.runOcrBatch(workingDirectory)

      // 4. Check that output/[basename].txt file exists
      const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
      const outputFilePath = path.join(outputDir, `${baseNameWithoutExt}.txt`)
      if (!fs.existsSync(outputFilePath)) {
        throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
      }

      // 5. Read output/[basename].txt file content
      const ocrText = await fs.promises.readFile(outputFilePath, 'utf-8')
      logger.info('OV OCR text extracted', { text: summarizeTextForLog(ocrText) })

      // 6. Return result
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
