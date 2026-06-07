/**
 * Entry point for the migration v2 window
 * Initializes the migration UI with @cherrystudio/ui components
 */
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import { initI18n } from './i18n'
import MigrationApp from './MigrationApp'

// Initialize logger for this window
loggerService.initWindowSource('MigrationV2')
const logger = loggerService.withContext('MigrationV2')

const root = createRoot(document.getElementById('root') as HTMLElement)

// Wait for i18n to be fully initialized before rendering
void initI18n()
  .catch((error) => {
    logger.error('Failed to initialize migration window i18n; rendering fallback UI', error as Error)
  })
  .finally(() => {
    root.render(<MigrationApp />)
  })
