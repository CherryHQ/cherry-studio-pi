import fs from 'node:fs'

import { rgPath } from '@vscode/ripgrep'

export function tryTestRipgrepPath(): string | null {
  const candidates = [process.env.RIPGREP_PATH, rgPath].filter(Boolean) as string[]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}
