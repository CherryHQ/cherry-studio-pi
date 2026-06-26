import type { Page } from '@playwright/test'

/**
 * Wait for the application to be fully ready.
 * The app uses PersistGate which may delay initial render.
 * Layout can be either Sidebar-based or TabsContainer-based depending on settings.
 */
export async function waitForAppReady(page: Page, timeout: number = 60000): Promise<void> {
  // First, wait for React root to be attached
  await page.waitForSelector('#root', { state: 'attached', timeout })

  const skipOnboardingButton = page.getByRole('button', { name: /跳过引导|skip/i }).first()
  try {
    await skipOnboardingButton.waitFor({ state: 'visible', timeout: 3000 })
    await skipOnboardingButton.click()
  } catch {
    // The onboarding screen only appears for fresh profiles.
  }

  // Wait for main app content to render. Avoid a broad comma selector here:
  // Playwright may lock onto the first hidden styled-component match.
  await page.waitForFunction(
    () => {
      const selectors = [
        '#home-page',
        'textarea',
        '[contenteditable="true"]',
        '[class*="Sidebar"]',
        '[class*="TabsContainer"]',
        '[class*="home-navbar"]',
        'a[href*="/settings/"]'
      ]

      const isVisible = (element: Element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

      const hasVisibleShell = selectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some(isVisible)
      )
      const bodyText = document.body?.innerText ?? ''

      return (
        hasVisibleShell || bodyText.includes('对话') || bodyText.includes('选择模型') || bodyText.includes('默认助手')
      )
    },
    undefined,
    { timeout }
  )

  // Additional wait for React to fully hydrate
  await page.waitForLoadState('domcontentloaded')
}

/**
 * Wait for navigation to a specific path.
 * The app uses HashRouter, so paths are prefixed with #.
 */
export async function waitForNavigation(page: Page, path: string, timeout: number = 15000): Promise<void> {
  await page.waitForURL(`**/#${path}**`, { timeout })
}

/**
 * Wait for the chat interface to be ready.
 */
export async function waitForChatReady(page: Page, timeout: number = 30000): Promise<void> {
  await page.waitForSelector(
    ['#home-page', '[class*="Chat"]', '[class*="Inputbar"]', '[class*="home-tabs"]'].join(', '),
    { state: 'visible', timeout }
  )
}

/**
 * Wait for the settings page to load.
 */
export async function waitForSettingsLoad(page: Page, timeout: number = 30000): Promise<void> {
  await page.waitForSelector(['[class*="SettingsPage"]', '[class*="Settings"]', 'a[href*="/settings/"]'].join(', '), {
    state: 'visible',
    timeout
  })
}

/**
 * Wait for a modal/dialog to appear.
 */
export async function waitForModal(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('.ant-modal, [role="dialog"], .ant-drawer', { state: 'visible', timeout })
}

/**
 * Wait for a modal/dialog to close.
 */
export async function waitForModalClose(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('.ant-modal, [role="dialog"], .ant-drawer', { state: 'hidden', timeout })
}

/**
 * Wait for loading state to complete.
 */
export async function waitForLoadingComplete(page: Page, timeout: number = 30000): Promise<void> {
  const spinner = page.locator('.ant-spin, [class*="Loading"], [class*="Spinner"]')
  if ((await spinner.count()) > 0) {
    await spinner.first().waitFor({ state: 'hidden', timeout })
  }
}

/**
 * Wait for a notification/toast to appear.
 */
export async function waitForNotification(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('.ant-notification, .ant-message, [class*="Notification"]', {
    state: 'visible',
    timeout
  })
}

/**
 * Sleep for a specified duration.
 * Use sparingly - prefer explicit waits when possible.
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
