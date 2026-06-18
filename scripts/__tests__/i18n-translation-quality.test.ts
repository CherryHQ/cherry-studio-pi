import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const TRANSLATE_DIR = path.resolve(process.cwd(), 'src/renderer/i18n/translate')

const FORBIDDEN_TRANSLATION_FRAGMENTS = [
  /I[’']m ready/i,
  /please provide/i,
  /you[’']d like translated/i,
  /Maximum nummer/i,
  /Añadir Acción/i,
  /Kliknout pro zobrazení/i,
  /Mostrar indicación/i,
  /até o primeiro token/i,
  /tok\/seg/i,
  /Autentificación fallida/i,
  /Logga ut/i,
  /Berhasil keluar/i,
  /Reinicio necesario/i,
  /Keluar/i
] as const

function readTranslateFiles() {
  return fs
    .readdirSync(TRANSLATE_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      file,
      content: fs.readFileSync(path.join(TRANSLATE_DIR, file), 'utf8')
    }))
}

describe('translated locale quality', () => {
  it('does not contain translator prompt replies or known cross-language mistranslations', () => {
    const violations = readTranslateFiles().flatMap(({ file, content }) =>
      FORBIDDEN_TRANSLATION_FRAGMENTS.flatMap((pattern) => {
        const match = content.match(pattern)
        return match ? [`${file}: ${match[0]}`] : []
      })
    )

    expect(violations).toEqual([])
  })
})
