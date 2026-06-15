import { APP_PRODUCT_NAME } from '@main/config/appIdentity'
import { app } from 'electron'

export function buildMcpClientInfo(version = app.getVersion()): { name: string; version: string } {
  return {
    name: APP_PRODUCT_NAME,
    version
  }
}

export function getMcpAppHeader(): string {
  return APP_PRODUCT_NAME
}
