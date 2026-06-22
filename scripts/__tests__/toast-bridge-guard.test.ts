import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const rendererRoot = path.resolve(process.cwd(), 'src/renderer')
const sourceExtensions = new Set(['.ts', '.tsx'])
const toastMethods = ['success', 'error', 'warning', 'info', 'loading', 'closeAll', 'closeToast', 'getToastQueue']
const requiredToastPatterns = [
  new RegExp(`window\\s*\\.\\s*toast\\s*\\.\\s*(${toastMethods.join('|')})\\s*\\(`, 'g'),
  /window\s*\.\s*toast\s*\[/g
]

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...listSourceFiles(fullPath))
      continue
    }

    if (!entry.isFile()) continue
    if (!sourceExtensions.has(path.extname(entry.name))) continue
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) continue
    if (entry.name.endsWith('.d.ts')) continue

    files.push(fullPath)
  }

  return files
}

function stripCommentsAndStrings(source: string): string {
  let output = ''
  let i = 0
  let state: 'normal' | 'line-comment' | 'block-comment' | 'single-quote' | 'double-quote' | 'template' = 'normal'

  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]

    if (state === 'line-comment') {
      if (char === '\n') {
        output += '\n'
        state = 'normal'
      } else {
        output += ' '
      }
      i += 1
      continue
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output += '  '
        state = 'normal'
        i += 2
      } else {
        output += char === '\n' ? '\n' : ' '
        i += 1
      }
      continue
    }

    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      const quote = state === 'single-quote' ? "'" : state === 'double-quote' ? '"' : '`'

      if (char === '\\') {
        output += ' '
        if (next) output += next === '\n' ? '\n' : ' '
        i += 2
        continue
      }

      output += char === '\n' ? '\n' : ' '

      if (char === quote) {
        state = 'normal'
      }

      i += 1
      continue
    }

    if (char === '/' && next === '/') {
      output += '  '
      state = 'line-comment'
      i += 2
      continue
    }

    if (char === '/' && next === '*') {
      output += '  '
      state = 'block-comment'
      i += 2
      continue
    }

    if (char === "'") {
      output += ' '
      state = 'single-quote'
      i += 1
      continue
    }

    if (char === '"') {
      output += ' '
      state = 'double-quote'
      i += 1
      continue
    }

    if (char === '`') {
      output += ' '
      state = 'template'
      i += 1
      continue
    }

    output += char
    i += 1
  }

  return output
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

describe('renderer toast bridge usage', () => {
  it('does not call toast methods through a required window.toast bridge', () => {
    const violations = listSourceFiles(rendererRoot).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const searchable = stripCommentsAndStrings(source)
      const matches = requiredToastPatterns.flatMap((pattern) => Array.from(searchable.matchAll(pattern)))

      return matches.map(
        (match) => `${path.relative(process.cwd(), file)}:${lineNumberAt(searchable, match.index ?? 0)}`
      )
    })

    expect(violations).toEqual([])
  })
})
