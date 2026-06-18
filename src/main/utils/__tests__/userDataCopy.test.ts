import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { copyActiveUserDataDirectory } from '../userDataCopy'

let rootDir: string
let sourceDir: string
let targetDir: string
let installDir: string

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('copyActiveUserDataDirectory', () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-pi-userdata-copy-'))
    sourceDir = path.join(rootDir, 'current-user-data')
    targetDir = path.join(rootDir, 'target-user-data')
    installDir = path.join(rootDir, 'install')
    fs.mkdirSync(sourceDir, { recursive: true })
    fs.mkdirSync(installDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('copies the active user data directory while skipping runtime-owned directories', async () => {
    writeFile(path.join(sourceDir, 'Data/main.db'), 'db')
    writeFile(path.join(sourceDir, 'logs/app.log'), 'log')
    writeFile(path.join(sourceDir, 'Network/Cookies'), 'cookies')
    writeFile(path.join(sourceDir, 'Partitions/webview/Network/Cookies'), 'webview cookies')

    await copyActiveUserDataDirectory({
      sourcePath: sourceDir,
      targetPath: targetDir,
      currentUserDataPath: sourceDir,
      installPath: installDir
    })

    expect(fs.readFileSync(path.join(targetDir, 'Data/main.db'), 'utf8')).toBe('db')
    expect(fs.existsSync(path.join(targetDir, 'logs/app.log'))).toBe(false)
    expect(fs.existsSync(path.join(targetDir, 'Network/Cookies'))).toBe(false)
    expect(fs.existsSync(path.join(targetDir, 'Partitions/webview/Network/Cookies'))).toBe(false)
  })

  it('rejects copying a directory that is not the active user data directory', async () => {
    const otherSource = path.join(rootDir, 'other-source')
    fs.mkdirSync(otherSource)

    await expect(
      copyActiveUserDataDirectory({
        sourcePath: otherSource,
        targetPath: targetDir,
        currentUserDataPath: sourceDir,
        installPath: installDir
      })
    ).rejects.toThrow('Only the active application data directory can be copied')
  })

  it('rejects target paths that are nested with the source path', async () => {
    await expect(
      copyActiveUserDataDirectory({
        sourcePath: sourceDir,
        targetPath: path.join(sourceDir, 'nested'),
        currentUserDataPath: sourceDir,
        installPath: installDir
      })
    ).rejects.toThrow('Target data path cannot be inside the current data directory')

    await expect(
      copyActiveUserDataDirectory({
        sourcePath: sourceDir,
        targetPath: rootDir,
        currentUserDataPath: sourceDir,
        installPath: installDir
      })
    ).rejects.toThrow('Target data path cannot contain the current data directory')
  })

  it('rejects target paths inside the application install directory', async () => {
    await expect(
      copyActiveUserDataDirectory({
        sourcePath: sourceDir,
        targetPath: path.join(installDir, 'Data'),
        currentUserDataPath: sourceDir,
        installPath: installDir
      })
    ).rejects.toThrow('Target data path cannot be inside the application install directory')
  })
})
