import { exec } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { summarizeProcessOutputForLog } from '@main/utils/logging'
import { getCpuName } from '@main/utils/system'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import * as fs from 'fs-extra'
import * as path from 'path'

import { storageV2SettingsRepository } from './storageV2/StorageV2Repositories'

const logger = loggerService.withContext('OvmsManager')

const execAsync = promisify(exec)
const STORAGE_V2_OVMS_SCOPE = 'ovms'
const STORAGE_V2_OVMS_CONFIG_SETTING_KEY = 'ovms.model_config'

export const isOvmsSupported = isWin && getCpuName().toLowerCase().includes('intel')

interface OvmsProcess {
  pid: number
  path: string
  workingDirectory: string
}

interface ModelConfig {
  name: string
  base_path: string
  [key: string]: unknown
}

interface OvmsConfig {
  mediapipe_config_list: ModelConfig[]
  model_config_list?: unknown[]
  [key: string]: unknown
}

type StoredOvmsConfig = {
  config: OvmsConfig
  updatedAtMs: number
}

type OvmsConfigProjection = {
  config: OvmsConfig
  mtimeMs: number
}

type OvmsStorageV2ConfigSetting = {
  config?: unknown
  updatedAt?: string
  sourcePath?: string
}

function getDefaultOvmsConfig(): OvmsConfig {
  return {
    mediapipe_config_list: [],
    model_config_list: []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseModelConfig(value: unknown): ModelConfig | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.base_path !== 'string') {
    return null
  }
  return {
    ...value,
    name: value.name,
    base_path: value.base_path
  }
}

function parseOvmsConfig(value: unknown): OvmsConfig | null {
  if (!isRecord(value)) return null

  const mediapipeConfigList = Array.isArray(value.mediapipe_config_list)
    ? value.mediapipe_config_list.map(parseModelConfig).filter((model): model is ModelConfig => Boolean(model))
    : []

  return {
    ...value,
    mediapipe_config_list: mediapipeConfigList,
    model_config_list: Array.isArray(value.model_config_list) ? value.model_config_list : []
  }
}

function configsEqual(left: OvmsConfig, right: OvmsConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getStoredOvmsConfig(value: unknown): StoredOvmsConfig | null {
  if (!isRecord(value)) return null
  const setting = value as OvmsStorageV2ConfigSetting
  const config = parseOvmsConfig(setting.config)
  if (!config) return null

  const updatedAtMs = typeof setting.updatedAt === 'string' ? Date.parse(setting.updatedAt) : 0
  return {
    config,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0
  }
}

class OvmsManager {
  private ovms: OvmsProcess | null = null

  constructor() {
    if (!isOvmsSupported) {
      throw new Error('OVMS Manager is only supported on Windows platform with Intel CPU.')
    }
  }

  private getOvmsDir(): string {
    return path.join(homedir(), HOME_CHERRY_DIR, 'ovms', 'ovms')
  }

  private getConfigPath(): string {
    return path.join(this.getOvmsDir(), 'models', 'config.json')
  }

  private getPatchDir(): string {
    return path.join(homedir(), HOME_CHERRY_DIR, 'ovms', 'patch')
  }

  private async readConfigProjection(): Promise<OvmsConfigProjection | null> {
    const configPath = this.getConfigPath()
    if (!(await fs.pathExists(configPath))) return null

    let config: OvmsConfig | null = null
    try {
      config = parseOvmsConfig(await fs.readJson(configPath))
    } catch (error) {
      logger.warn(`Failed to parse OVMS config projection: ${configPath}`, error as Error)
      return null
    }
    if (!config) {
      logger.warn(`Invalid OVMS config projection: ${configPath}`)
      return null
    }

    const stats = await fs.stat(configPath).catch(() => null)
    return {
      config,
      mtimeMs: stats?.mtimeMs ?? 0
    }
  }

  private async loadConfigFromStorageV2(): Promise<StoredOvmsConfig | null> {
    return getStoredOvmsConfig(await storageV2SettingsRepository.get(STORAGE_V2_OVMS_CONFIG_SETTING_KEY))
  }

  private async saveConfigToStorageV2(config: OvmsConfig): Promise<void> {
    await storageV2SettingsRepository.set(
      STORAGE_V2_OVMS_CONFIG_SETTING_KEY,
      {
        config,
        sourcePath: this.getConfigPath(),
        updatedAt: new Date().toISOString()
      } satisfies OvmsStorageV2ConfigSetting,
      STORAGE_V2_OVMS_SCOPE
    )
  }

  private async writeConfigProjection(config: OvmsConfig): Promise<void> {
    const configPath = this.getConfigPath()
    await fs.ensureDir(path.dirname(configPath))
    await fs.writeJson(configPath, config, { spaces: 2 })
    logger.info(`Config file projected from Storage v2: ${configPath}`)
  }

  private shouldImportProjection(projection: OvmsConfigProjection, stored: StoredOvmsConfig | null): boolean {
    if (!stored) return true
    if (configsEqual(projection.config, stored.config)) return false
    return projection.mtimeMs > stored.updatedAtMs
  }

  private async loadAuthoritativeConfig(options: { createDefault?: boolean } = {}): Promise<OvmsConfig | null> {
    const projection = await this.readConfigProjection()
    const stored = await this.loadConfigFromStorageV2()

    if (projection && this.shouldImportProjection(projection, stored)) {
      await this.saveConfigToStorageV2(projection.config)
      logger.info('Imported OVMS config projection into Storage v2')
      return projection.config
    }

    if (stored) {
      if (!projection || !configsEqual(projection.config, stored.config)) {
        await this.writeConfigProjection(stored.config)
      }
      return stored.config
    }

    if (!options.createDefault) {
      return null
    }

    const defaultConfig = getDefaultOvmsConfig()
    await this.saveConfigToStorageV2(defaultConfig)
    await this.writeConfigProjection(defaultConfig)
    return defaultConfig
  }

  /**
   * Recursively terminate a process and all its child processes
   * @param pid Process ID to terminate
   * @returns Promise<{ success: boolean; message?: string }>
   */
  private async terminalProcess(pid: number): Promise<{ success: boolean; message?: string }> {
    try {
      // Check if the process is running
      const processCheckCommand = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json`
      const { stdout: processStdout } = await execAsync(`powershell -Command "${processCheckCommand}"`)

      if (!processStdout.trim()) {
        logger.info(`Process with PID ${pid} is not running`)
        return { success: true, message: `Process with PID ${pid} is not running` }
      }

      // Find child processes
      const childProcessCommand = `Get-WmiObject -Class Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | Select-Object ProcessId | ConvertTo-Json`
      const { stdout: childStdout } = await execAsync(`powershell -Command "${childProcessCommand}"`)

      // If there are child processes, terminate them first
      if (childStdout.trim()) {
        const childProcesses = JSON.parse(childStdout)
        const childList = Array.isArray(childProcesses) ? childProcesses : [childProcesses]

        logger.info(`Found ${childList.length} child processes for PID ${pid}`)

        // Recursively terminate each child process
        for (const childProcess of childList) {
          const childPid = childProcess.ProcessId
          logger.info(`Terminating child process PID: ${childPid}`)
          await this.terminalProcess(childPid)
        }
      } else {
        logger.info(`No child processes found for PID ${pid}`)
      }

      // Finally, terminate the parent process
      const killCommand = `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`
      await execAsync(`powershell -Command "${killCommand}"`)
      logger.info(`Terminated process with PID: ${pid}`)

      // Wait for the process to disappear with 5-second timeout
      const timeout = 5000 // 5 seconds
      const startTime = Date.now()

      while (Date.now() - startTime < timeout) {
        const checkCommand = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json`
        const { stdout: checkStdout } = await execAsync(`powershell -Command "${checkCommand}"`)

        if (!checkStdout.trim()) {
          logger.info(`Process with PID ${pid} has disappeared`)
          return { success: true, message: `Process ${pid} and all child processes terminated successfully` }
        }

        // Wait 300ms before checking again
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      logger.warn(`Process with PID ${pid} did not disappear within timeout`)
      return { success: false, message: `Process ${pid} did not disappear within 5 seconds` }
    } catch (error) {
      logger.error(`Failed to terminate process ${pid}:`, error as Error)
      return { success: false, message: `Failed to terminate process ${pid}` }
    }
  }

  /**
   * Stop OVMS process if it's running
   * @returns Promise<{ success: boolean; message?: string }>
   */
  public async stopOvms(): Promise<{ success: boolean; message?: string }> {
    try {
      // close the OVMS process
      await execAsync(
        `powershell -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like 'ovms.exe*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`
      )

      // Reset the ovms instance
      this.ovms = null

      logger.info('OVMS process stopped successfully')
      return { success: true, message: 'OVMS process stopped successfully' }
    } catch (error) {
      logger.error(`Failed to stop OVMS process: ${error}`)
      return { success: false, message: 'Failed to stop OVMS process' }
    }
  }

  /**
   * Run OVMS by ensuring config.json exists and executing run.bat
   * @returns Promise<{ success: boolean; message?: string }>
   */
  public async runOvms(): Promise<{ success: boolean; message?: string }> {
    const ovmsDir = this.getOvmsDir()
    const runBatPath = path.join(ovmsDir, 'run.bat')

    try {
      await this.loadAuthoritativeConfig({ createDefault: true })

      // Check if run.bat exists
      if (!(await fs.pathExists(runBatPath))) {
        logger.error(`run.bat not found at: ${runBatPath}`)
        return { success: false, message: 'run.bat not found' }
      }

      // Run run.bat without waiting for it to complete
      logger.info(`Starting OVMS with run.bat: ${runBatPath}`)
      exec(`"${runBatPath}"`, { cwd: ovmsDir }, (error) => {
        if (error) {
          logger.error(`Error running run.bat: ${error}`)
        }
      })

      logger.info('OVMS started successfully')
      return { success: true }
    } catch (error) {
      logger.error(`Failed to run OVMS: ${error}`)
      return { success: false, message: 'Failed to run OVMS' }
    }
  }

  /**
   * Get OVMS status - checks installation and running status
   * @returns 'not-installed' | 'not-running' | 'running'
   */
  public async getOvmsStatus(): Promise<'not-installed' | 'not-running' | 'running'> {
    const ovmsPath = path.join(this.getOvmsDir(), 'ovms.exe')

    try {
      // Check if OVMS executable exists
      if (!(await fs.pathExists(ovmsPath))) {
        logger.info(`OVMS executable not found at: ${ovmsPath}`)
        return 'not-installed'
      }

      // Check if OVMS process is running
      //const psCommand = `Get-Process -Name "ovms" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "${ovmsPath.replace(/\\/g, '\\\\')}" } | Select-Object Id | ConvertTo-Json`;
      //const { stdout } = await execAsync(`powershell -Command "${psCommand}"`);
      const psCommand = `Get-Process -Name "ovms" -ErrorAction SilentlyContinue | Select-Object Id, Path | ConvertTo-Json`
      const { stdout } = await execAsync(`powershell -Command "${psCommand}"`)

      if (!stdout.trim()) {
        logger.info('OVMS process not running')
        return 'not-running'
      }

      const processes = JSON.parse(stdout)
      const processList = Array.isArray(processes) ? processes : [processes]

      if (processList.length > 0) {
        logger.info('OVMS process is running')
        return 'running'
      } else {
        logger.info('OVMS process not running')
        return 'not-running'
      }
    } catch (error) {
      logger.info(`Failed to check OVMS status: ${error}`)
      return 'not-running'
    }
  }

  /**
   * Initialize OVMS by finding the executable path and working directory
   */
  public async initializeOvms(): Promise<boolean> {
    // Use PowerShell to find ovms.exe processes with their paths
    const psCommand = `Get-Process -Name "ovms" -ErrorAction SilentlyContinue | Select-Object Id, Path | ConvertTo-Json`
    const { stdout } = await execAsync(`powershell -Command "${psCommand}"`)

    if (!stdout.trim()) {
      logger.error('Command to find OVMS process returned no output')
      return false
    }
    logger.debug('OVMS process output received', { stdout: summarizeProcessOutputForLog(stdout) })

    const processes = JSON.parse(stdout)
    const processList = Array.isArray(processes) ? processes : [processes]

    // Find the first process with a valid path
    for (const process of processList) {
      this.ovms = {
        pid: process.Id,
        path: process.Path,
        workingDirectory: path.dirname(process.Path)
      }
      return true
    }

    return this.ovms !== null
  }

  /**
   * Check if the Model Name and ID are valid, they are valid only if they are not used in the config.json
   * @param modelName Name of the model to check
   * @param modelId ID of the model to check
   */
  public async isNameAndIDAvalid(modelName: string, modelId: string): Promise<boolean> {
    if (!modelName || !modelId) {
      logger.error('Model name and ID cannot be empty')
      return false
    }

    try {
      const config = await this.loadAuthoritativeConfig()
      if (!config) {
        logger.warn(`Config file does not exist: ${this.getConfigPath()}`)
        return false
      }

      if (!config.mediapipe_config_list) {
        logger.warn(`No mediapipe_config_list found in config: ${this.getConfigPath()}`)
        return false
      }

      // Check if the model name or ID already exists in the config
      const exists = config.mediapipe_config_list.some(
        (model) => model.name === modelName || model.base_path === modelId
      )
      if (exists) {
        logger.warn(`Model with name "${modelName}" or ID "${modelId}" already exists in the config`)
        return false
      }
    } catch (error) {
      logger.error(`Failed to check model existence: ${error}`)
      return false
    }

    return true
  }

  private async applyModelPath(modelDirPath: string): Promise<boolean> {
    const patchDir = this.getPatchDir()
    if (!(await fs.pathExists(patchDir))) {
      return true
    }

    const modelId = path.basename(modelDirPath)

    // get all sub directories in patchDir
    const patchs = await fs.readdir(patchDir)
    for (const patch of patchs) {
      const fullPatchPath = path.join(patchDir, patch)

      if (fs.lstatSync(fullPatchPath).isDirectory()) {
        if (modelId.toLowerCase().includes(patch.toLowerCase())) {
          // copy all files from fullPath to modelDirPath
          try {
            const files = await fs.readdir(fullPatchPath)
            for (const file of files) {
              const srcFile = path.join(fullPatchPath, file)
              const destFile = path.join(modelDirPath, file)
              await fs.copyFile(srcFile, destFile)
            }
          } catch (error) {
            logger.error(`Failed to copy files from ${fullPatchPath} to ${modelDirPath}: ${error}`)
            return false
          }
          logger.info(`Applied patchs for model ${modelId}`)
          return true
        }
      }
    }

    return true
  }

  /**
   * Add a model to OVMS by downloading it
   * @param modelName Name of the model to add
   * @param modelId ID of the model to download
   * @param modelSource Model Source: huggingface, hf-mirror and modelscope, default is huggingface
   * @param task Task type: text_generation, embedding, rerank, image_generation
   */
  public async addModel(
    modelName: string,
    modelId: string,
    modelSource: string,
    task: string = 'text_generation'
  ): Promise<{ success: boolean; message?: string }> {
    logger.info(`Adding model: ${modelName} with ID: ${modelId}, Source: ${modelSource}, Task: ${task}`)

    const ovdndDir = this.getOvmsDir()
    const pathModel = path.join(ovdndDir, 'models', modelId)

    try {
      // check the ovdnDir+'models'+modelId exist or not
      if (await fs.pathExists(pathModel)) {
        logger.error(`Model with ID ${modelId} already exists`)
        return { success: false, message: 'Model ID already exists!' }
      }

      // remove the model directory if it exists
      if (await fs.pathExists(pathModel)) {
        logger.info(`Removing existing model directory: ${pathModel}`)
        await fs.remove(pathModel)
      }

      // Use ovdnd.exe for downloading instead of ovms.exe
      const ovdndPath = path.join(ovdndDir, 'ovdnd.exe')
      const command =
        `"${ovdndPath}" --pull ` +
        `--model_repository_path "${ovdndDir}/models" ` +
        `--source_model "${modelId}" ` +
        `--model_name "${modelName}" ` +
        `--target_device GPU ` +
        `--task ${task} ` +
        `--overwrite_models`

      const env: Record<string, string | undefined> = {
        ...process.env,
        OVMS_DIR: ovdndDir,
        PYTHONHOME: path.join(ovdndDir, 'python'),
        PATH: `${process.env.PATH};${ovdndDir};${path.join(ovdndDir, 'python')}`
      }

      if (modelSource) {
        env.HF_ENDPOINT = modelSource
      }

      logger.info(`Running command: ${command} from ${modelSource}`)
      const { stdout } = await execAsync(command, { env: env, cwd: ovdndDir })

      logger.info('Model download completed')
      logger.debug('Model download command output received', { stdout: summarizeProcessOutputForLog(stdout) })
    } catch (error) {
      // remove ovdnDir+'models'+modelId if it exists
      if (await fs.pathExists(pathModel)) {
        logger.info(`Removing failed model directory: ${pathModel}`)
        await fs.remove(pathModel)
      }
      logger.error(`Failed to add model: ${error}`)
      return {
        success: false,
        message: `Download model ${modelId} failed, please check following items and try it again:<p>- the model id</p><p>- network connection and proxy</p>`
      }
    }

    // Update config file
    if (!(await this.updateModelConfig(modelName, modelId))) {
      logger.error('Failed to update model config')
      return { success: false, message: 'Failed to update model config' }
    }

    if (!(await this.applyModelPath(pathModel))) {
      logger.error('Failed to apply model patchs')
      return { success: false, message: 'Failed to apply model patchs' }
    }

    logger.info(`Model ${modelName} added successfully with ID ${modelId}`)
    return { success: true }
  }

  /**
   * Stop the model download process if it's running
   * @returns Promise<{ success: boolean; message?: string }>
   */
  public async stopAddModel(): Promise<{ success: boolean; message?: string }> {
    try {
      // Check if ovdnd.exe process is running
      const psCommand = `Get-Process -Name "ovdnd" -ErrorAction SilentlyContinue | Select-Object Id, Path | ConvertTo-Json`
      const { stdout } = await execAsync(`powershell -Command "${psCommand}"`)

      if (!stdout.trim()) {
        logger.info('ovdnd process is not running')
        return { success: true, message: 'Model download process is not running' }
      }

      const processes = JSON.parse(stdout)
      const processList = Array.isArray(processes) ? processes : [processes]

      if (processList.length === 0) {
        logger.info('ovdnd process is not running')
        return { success: true, message: 'Model download process is not running' }
      }

      // Terminate all ovdnd processes
      for (const process of processList) {
        void this.terminalProcess(process.Id)
      }

      logger.info('Model download process stopped successfully')
      return { success: true, message: 'Model download process stopped successfully' }
    } catch (error) {
      logger.error(`Failed to stop model download process: ${error}`)
      return { success: false, message: 'Failed to stop model download process' }
    }
  }

  /**
   * check if the model id exists in the OVMS configuration
   * @param modelId ID of the model to check
   */
  public async checkModelExists(modelId: string): Promise<boolean> {
    try {
      const config = await this.loadAuthoritativeConfig()
      if (!config) {
        logger.warn(`Config file does not exist: ${this.getConfigPath()}`)
        return false
      }

      if (!config.mediapipe_config_list) {
        logger.warn('No mediapipe_config_list found in config')
        return false
      }

      return config.mediapipe_config_list.some((model) => model.base_path === modelId)
    } catch (error) {
      logger.error(`Failed to check model existence: ${error}`)
      return false
    }
  }

  /**
   * Update the model configuration file
   */
  public async updateModelConfig(modelName: string, modelId: string): Promise<boolean> {
    try {
      const config = (await this.loadAuthoritativeConfig({ createDefault: true })) ?? getDefaultOvmsConfig()

      // Ensure mediapipe_config_list exists
      if (!config.mediapipe_config_list) {
        config.mediapipe_config_list = []
      }

      // Add new model config
      const newModelConfig: ModelConfig = {
        name: modelName,
        base_path: modelId
      }

      // Check if model already exists, if so, update it
      const existingIndex = config.mediapipe_config_list.findIndex((model) => model.base_path === modelId)

      if (existingIndex >= 0) {
        config.mediapipe_config_list[existingIndex] = newModelConfig
        logger.info(`Updated existing model config: ${modelName}`)
      } else {
        config.mediapipe_config_list.push(newModelConfig)
        logger.info(`Added new model config: ${modelName}`)
      }

      await this.saveConfigToStorageV2(config)
      await this.writeConfigProjection(config)
    } catch (error) {
      logger.error(`Failed to update model config: ${error}`)
      return false
    }
    return true
  }

  /**
   * Get all models from OVMS config, filtered for image generation models
   * @returns Array of model configurations
   */
  public async getModels(): Promise<ModelConfig[]> {
    try {
      const config = await this.loadAuthoritativeConfig()
      if (!config) {
        logger.warn(`Config file does not exist: ${this.getConfigPath()}`)
        return []
      }

      if (!config.mediapipe_config_list) {
        logger.warn('No mediapipe_config_list found in config')
        return []
      }

      // Filter models for image generation (SD, Stable-Diffusion, Stable Diffusion, FLUX)
      const imageGenerationModels = config.mediapipe_config_list.filter((model) => {
        const modelName = model.name.toLowerCase()
        return (
          modelName.startsWith('sd') ||
          modelName.startsWith('stable-diffusion') ||
          modelName.startsWith('stable diffusion') ||
          modelName.startsWith('flux')
        )
      })

      logger.info(`Found ${imageGenerationModels.length} image generation models`)
      return imageGenerationModels
    } catch (error) {
      logger.error(`Failed to get models: ${error}`)
      return []
    }
  }
}

// Export singleton instance
export const ovmsManager = isOvmsSupported ? new OvmsManager() : undefined
