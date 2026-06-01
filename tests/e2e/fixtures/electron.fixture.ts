import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, test as base } from '@playwright/test'

/**
 * Custom fixtures for Electron e2e testing.
 * Provides electronApp and mainWindow to all tests.
 */
export type ElectronFixtures = {
  electronApp: ElectronApplication
  mainWindow: Page
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'cherry-studio-pi-e2e-'))

    // Launch Electron app from project root
    // The args ['.'] tells Electron to load the app from current directory
    const electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        CHERRY_STUDIO_STORAGE_V2_ROOT: path.join(userDataDir, 'Data'),
        CHERRY_STUDIO_USER_DATA_DIR: userDataDir
      },
      timeout: 60000
    })

    try {
      await use(electronApp)
    } finally {
      await electronApp.close().catch(() => undefined)
      await rm(userDataDir, { recursive: true, force: true })
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for the main window (not "Quick Assistant").
    // On Mac, the app may create miniWindow for QuickAssistant with different title
    let mainWindow = await electronApp.firstWindow({ timeout: 60000 })
    let title = await mainWindow.title()

    if (title !== 'Cherry Studio Pi' && title !== 'Cherry Studio') {
      mainWindow = await electronApp.waitForEvent('window', {
        predicate: async (window) => {
          title = await window.title()
          return title === 'Cherry Studio Pi' || title === 'Cherry Studio'
        },
        timeout: 60000
      })
    }

    // Wait for React app to mount
    await mainWindow.waitForSelector('#root', { state: 'attached', timeout: 60000 })

    // Wait for initial content to load
    await mainWindow.waitForLoadState('domcontentloaded')

    await use(mainWindow)
  }
})

export { expect } from '@playwright/test'
