import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  APP_ID,
  APP_PROCESS_IDENTIFIERS,
  APP_PRODUCT_NAME,
  ELECTRON_DEV_APP_ID,
  isAppProcessIdentifier,
  LEGACY_APP_ID
} from '../appIdentity'

describe('appIdentity', () => {
  it('keeps runtime identity aligned with the packaged app identity', () => {
    const builderConfig = parse(readFileSync(path.join(process.cwd(), 'electron-builder.yml'), 'utf8')) as {
      appId: string
      productName: string
    }

    expect(APP_ID).toBe(builderConfig.appId)
    expect(APP_PRODUCT_NAME).toBe(builderConfig.productName)
  })

  it('recognizes packaged, legacy, and development process identifiers as self', () => {
    expect(APP_PROCESS_IDENTIFIERS).toContain(APP_ID)
    expect(APP_PROCESS_IDENTIFIERS).toContain(LEGACY_APP_ID)
    expect(APP_PROCESS_IDENTIFIERS).toContain(ELECTRON_DEV_APP_ID)
    expect(isAppProcessIdentifier(APP_ID)).toBe(true)
    expect(isAppProcessIdentifier(LEGACY_APP_ID)).toBe(true)
    expect(isAppProcessIdentifier(ELECTRON_DEV_APP_ID)).toBe(true)
    expect(isAppProcessIdentifier('com.example.other')).toBe(false)
  })
})
