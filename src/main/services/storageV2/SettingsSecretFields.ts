export type StorageV2FlatSettingsSecretField = {
  key: string
  kind: string
}

export const STORAGE_V2_FLAT_SETTINGS_SECRET_FIELDS: StorageV2FlatSettingsSecretField[] = [
  { key: 'webdavPass', kind: 'backupWebdavPassword' },
  { key: 'dataSyncWebdavPass', kind: 'dataSyncWebdavPassword' },
  { key: 'notionApiKey', kind: 'notionApiKey' },
  { key: 'yuqueToken', kind: 'yuqueToken' },
  { key: 'joplinToken', kind: 'joplinToken' },
  { key: 'siyuanToken', kind: 'siyuanToken' }
]

const STORAGE_V2_FLAT_SETTINGS_SECRET_FIELDS_BY_KEY = new Map(
  STORAGE_V2_FLAT_SETTINGS_SECRET_FIELDS.map((field) => [field.key, field])
)

export function getStorageV2FlatSettingsSecretField(key: string): StorageV2FlatSettingsSecretField | undefined {
  return STORAGE_V2_FLAT_SETTINGS_SECRET_FIELDS_BY_KEY.get(key)
}
