import { APP_COMPACT_NAME } from '@main/config/appIdentity'
import { app } from 'electron'

export function buildSkillMarketplaceUserAgent(version = app.getVersion()): string {
  return `${APP_COMPACT_NAME}/${version}`
}
