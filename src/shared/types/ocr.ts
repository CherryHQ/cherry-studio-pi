import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { ImageFileMetadata } from '@shared/data/types/legacyFile'
import type Tesseract from 'tesseract.js'

export const BuiltinOcrProviderIds = {
  tesseract: 'tesseract',
  system: 'system',
  paddleocr: 'paddleocr',
  ovocr: 'ovocr'
} as const

export type BuiltinOcrProviderId = keyof typeof BuiltinOcrProviderIds

export const OcrProviderCapabilities = {
  image: 'image'
} as const

export type OcrProviderCapability = keyof typeof OcrProviderCapabilities
export type OcrProviderCapabilityRecord = Partial<Record<OcrProviderCapability, boolean>>
export type OcrModelCapabilityRecord = OcrProviderCapabilityRecord

export interface OcrModel {
  id: string
  name: string
  providerId: string
  capabilities: OcrModelCapabilityRecord
}

export type OcrProviderApiConfig = {
  apiKey: string
  apiHost: string
  apiVersion?: string
}

export type OcrProviderBaseConfig = {
  api?: OcrProviderApiConfig
  models?: OcrModel[]
  enabled?: boolean
}

export type OcrProviderConfig = OcrApiProviderConfig | OcrTesseractConfig | OcrSystemConfig | OcrPpocrConfig

export type OcrProvider = {
  id: string
  name: string
  capabilities: OcrProviderCapabilityRecord
  config?: OcrProviderBaseConfig
}

export type OcrApiProviderConfig = OcrProviderBaseConfig & {
  api: OcrProviderApiConfig
}

export type OcrApiProvider = OcrProvider & {
  config: OcrApiProviderConfig
}

export type BuiltinOcrProvider = OcrProvider & {
  id: BuiltinOcrProviderId
}

export type CustomOcrProvider = OcrProvider & {
  id: Exclude<string, BuiltinOcrProviderId>
}

export type ImageOcrProvider = OcrProvider & {
  capabilities: OcrProviderCapabilityRecord & {
    [OcrProviderCapabilities.image]: true
  }
}

export type SupportedOcrFile = ImageFileMetadata

export type OcrResult = {
  text: string
}

export type OcrHandler = (file: SupportedOcrFile, options?: OcrProviderBaseConfig) => Promise<OcrResult>
export type OcrImageHandler = (file: ImageFileMetadata, options?: OcrProviderBaseConfig) => Promise<OcrResult>

export type OcrTesseractConfig = OcrProviderBaseConfig & {
  langs?: Partial<Record<TesseractLangCode, boolean>>
}

export type OcrTesseractProvider = {
  id: 'tesseract'
  config: OcrTesseractConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

export type TesseractLangCode = Tesseract.LanguageCode

export type OcrSystemConfig = OcrProviderBaseConfig & {
  langs?: TranslateLangCode[]
}

export type OcrSystemProvider = {
  id: 'system'
  config: OcrSystemConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

export type OcrPpocrConfig = OcrProviderBaseConfig & {
  apiUrl?: string
  accessToken?: string
}

export type OcrPpocrProvider = {
  id: 'paddleocr'
  config: OcrPpocrConfig
} & ImageOcrProvider &
  BuiltinOcrProvider

export type OcrOvConfig = OcrProviderBaseConfig & {
  langs?: TranslateLangCode[]
}

export type OcrOvProvider = {
  id: 'ovocr'
  config: OcrOvConfig
} & ImageOcrProvider &
  BuiltinOcrProvider
