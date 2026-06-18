/**
 * `.gitignore`-based ignore predicate for `DirectoryTreeBuilder`.
 *
 * **Single source of truth, three consumers.** The predicate built here is
 * consulted by:
 *   - chokidar's `ignored` option (watcher path)
 *   - the builder's post-scan filter (belt-and-suspenders for chokidar
 *     races on `node_modules`-heavy repos)
 *   - ripgrep's `-g !pattern` arguments at initial-scan time, derived from
 *     the same `DEFAULT_IGNORE_PATTERNS` via `defaultRipgrepGlobArgs()`
 *
 * Three layers, one constant. Previously the ripgrep `-g` list lived
 * separately in `search.ts` and drifted from the chokidar predicate —
 * `.DS_Store` / `node_modules` created **after** mount slipped past
 * chokidar even though ripgrep filtered them at scan time.
 *
 * The `.git` directory is always force-added because git itself doesn't
 * list its own internal dir in `.gitignore`, but watching it is both
 * pointless and expensive (chokidar would open one FD per packed-ref /
 * hooks / objects subdir on every commit). The force-add happens last so
 * a user-side `!.git` cannot un-ignore it.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import ignore, { type Ignore } from 'ignore'

const logger = loggerService.withContext('file/tree/gitignore')

/**
 * Default exclusions applied to every workspace — VCS / build artifacts /
 * OS metadata files. Patterns follow gitignore syntax (trailing `/`
 * means "directory only"). User `.gitignore` rules are applied **after**
 * these so a deliberate `!node_modules` etc. still wins.
 */
const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // macOS / Windows OS noise
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  // Common build / dependency caches
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '.nuxt/',
  'coverage/',
  '.cache/',
  // Editor metadata
  '.vscode/',
  '.idea/'
]

/**
 * Convert `DEFAULT_IGNORE_PATTERNS` into ripgrep `-g !pattern` arguments.
 * Directory patterns (trailing `/`) produce `!**\/dir/**`, file patterns
 * produce `!**\/name`. `.git` is always force-excluded last.
 *
 * Single bridge from gitignore-syntax defaults to ripgrep CLI; callers in
 * `search.ts` use this instead of maintaining a parallel exclude list.
 */
export function defaultRipgrepGlobArgs(): string[] {
  const args: string[] = []
  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (pattern.endsWith('/')) {
      args.push('-g', `!**/${pattern.slice(0, -1)}/**`)
    } else {
      args.push('-g', `!**/${pattern}`)
    }
  }
  args.push('-g', '!**/.git/**')
  return args
}

export interface GitignorePredicate {
  /** True if the absolute path should be excluded from scan/watch. */
  (absPath: string): boolean
}

export function normalizeGitignoreRootPath(rootPath: string): string {
  return rootPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
}

export function relativePathFromGitignoreRoot(absPath: string, normalizedRoot: string): string | null {
  const normalized = absPath.replace(/\\/g, '/')
  if (normalized === normalizedRoot) return null

  if (normalizedRoot === '/') {
    const rel = normalized.startsWith('/') ? normalized.slice(1) : normalized
    return rel || null
  }

  if (!normalized.startsWith(`${normalizedRoot}/`)) return null
  const rel = normalized.slice(normalizedRoot.length + 1)
  return rel || null
}

/**
 * Build a predicate from `${rootPath}/.gitignore`.
 *
 * Always returns at least a `.git`-only predicate; the result is `null`
 * **only** if the `ignore` library itself fails to construct. Callers
 * therefore cannot treat `null` as "no exclusion at all" — `.git` must
 * stay excluded regardless of whether the user's `.gitignore` parsed.
 *
 * A missing `.gitignore` is not an error (returns the `.git`-only
 * predicate). EACCES / EIO on the read is logged as a warning so the
 * operator can debug permission / filesystem problems, but the predicate
 * is still produced so `.git` stays excluded.
 *
 * Async by design: `.gitignore` may live on a slow filesystem (network
 * share, fuse, …), so callers must await this off the main-process event
 * loop rather than block startup with a sync read.
 */
export async function loadGitignorePredicate(rootPath: string): Promise<GitignorePredicate | null> {
  const normalizedRoot = normalizeGitignoreRootPath(rootPath)
  let raw: string | null = null
  try {
    raw = await readFile(path.join(rootPath || normalizedRoot, '.gitignore'), 'utf8')
  } catch (err) {
    // ENOENT = no `.gitignore` at all, which is expected and benign.
    // EACCES / EIO / other = the file exists but we couldn't read it;
    // worth logging so a confused operator (or a future incident) can
    // trace why `.gitignore` rules silently stopped applying.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logger.warn(`Could not read .gitignore under ${normalizedRoot} (${code ?? 'unknown'})`, err as Error)
    }
  }

  let ig: Ignore
  try {
    ig = ignore()
    // Defaults first so the user's `.gitignore` can override (`!pattern`).
    ig.add(DEFAULT_IGNORE_PATTERNS.join('\n'))
    if (raw) ig.add(raw)
    // `.git` is force-ignored last — user cannot un-ignore it.
    ig.add('.git')
  } catch (err) {
    logger.warn(`Failed to parse .gitignore under ${normalizedRoot}`, err as Error)
    return null
  }

  return (absPath: string) => {
    const rel = relativePathFromGitignoreRoot(absPath, normalizedRoot)
    if (!rel) return false
    return ig.ignores(rel)
  }
}
