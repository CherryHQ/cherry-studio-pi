import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function loadInternal() {
  delete require.cache[require.resolve('../version.js')]
  return require('../version.js')._internal
}

describe('version script', () => {
  it('parses version bump arguments without executing on import', () => {
    const { parseVersionArgs } = loadInternal()

    expect(parseVersionArgs([])).toEqual({ shouldPush: false, versionType: 'patch' })
    expect(parseVersionArgs(['minor'])).toEqual({ shouldPush: false, versionType: 'minor' })
  })

  it('rejects local release tag pushes', () => {
    const { parseVersionArgs } = loadInternal()

    expect(() => parseVersionArgs(['minor', 'push'])).toThrow('Local release tag pushing is disabled')
  })

  it('rejects unsupported version bump types', () => {
    const { parseVersionArgs } = loadInternal()

    expect(() => parseVersionArgs(['nightly'])).toThrow('Invalid version type')
  })

  it('uses pnpm.cmd on Windows without relying on shell lookup', () => {
    const { getPnpmExecutable } = loadInternal()

    expect(getPnpmExecutable('win32')).toBe('pnpm.cmd')
    expect(getPnpmExecutable('darwin')).toBe('pnpm')
    expect(getPnpmExecutable('linux')).toBe('pnpm')
  })

  it('normalizes supported GitHub remote URL shapes', () => {
    const { normalizeGitHubRepositorySlug } = loadInternal()

    expect(normalizeGitHubRepositorySlug('https://github.com/CherryHQ/cherry-studio-pi.git')).toBe(
      'cherryhq/cherry-studio-pi'
    )
    expect(normalizeGitHubRepositorySlug('git@github.com:CherryHQ/cherry-studio-pi.git')).toBe(
      'cherryhq/cherry-studio-pi'
    )
    expect(normalizeGitHubRepositorySlug('ssh://git@github.com/CherryHQ/cherry-studio-pi.git')).toBe(
      'cherryhq/cherry-studio-pi'
    )
    expect(normalizeGitHubRepositorySlug('https://example.com/CherryHQ/cherry-studio-pi.git')).toBeNull()
  })

  it('refuses to bump Pi releases from the upstream Cherry Studio repository', () => {
    const { assertCherryStudioPiOrigin } = loadInternal()

    expect(() => assertCherryStudioPiOrigin('https://github.com/CherryHQ/cherry-studio-pi.git')).not.toThrow()
    expect(() => assertCherryStudioPiOrigin('git@github.com:CherryHQ/cherry-studio-pi.git')).not.toThrow()
    expect(() => assertCherryStudioPiOrigin('https://github.com/CherryHQ/cherry-studio.git')).toThrow(
      'Refusing to bump a Cherry Studio Pi release outside CherryHQ/cherry-studio-pi'
    )
  })

  it('extracts semantic versions from local and remote git tag output', () => {
    const { extractVersionsFromGitRefs } = loadInternal()

    expect(
      extractVersionsFromGitRefs(
        [
          'v1.9.31',
          '36bdf0a0c146767fe256c56fb83af4851fbe3702\trefs/tags/v1.9.33',
          'fac0c9fe125e94039ca5c1e618581fec37a664b6\trefs/tags/v1.9.18^{}',
          'not-a-version'
        ].join('\n')
      )
    ).toEqual(['1.9.31', '1.9.33', '1.9.18'])
  })

  it('bumps from the highest known version instead of stale package.json', () => {
    const { resolveNextVersion } = loadInternal()

    expect(resolveNextVersion('1.9.21', 'patch', ['1.9.21', '1.9.33'])).toEqual({
      baseVersion: '1.9.33',
      nextVersion: '1.9.34'
    })
  })

  it('sorts prerelease and release versions with semver rules', () => {
    const { getHighestVersion } = loadInternal()

    expect(getHighestVersion(['1.9.33', '1.10.0-beta.1', '1.10.0'])).toBe('1.10.0')
  })

  it('prefers remote release tags over local tags when both are available', () => {
    const { selectKnownVersions, resolveNextVersion } = loadInternal()
    const knownVersions = selectKnownVersions('1.9.33', ['1.9.34'], ['99.0.0'])

    expect(knownVersions).toEqual(['1.9.33', '1.9.34'])
    expect(resolveNextVersion('1.9.33', 'patch', knownVersions)).toEqual({
      baseVersion: '1.9.34',
      nextVersion: '1.9.35'
    })
  })

  it('falls back to local release tags when remote tags are unavailable', () => {
    const { selectKnownVersions } = loadInternal()

    expect(selectKnownVersions('1.9.33', [], ['1.9.34'])).toEqual(['1.9.33', '1.9.34'])
  })

  it('prints manual push instructions without publishing installers', () => {
    const { getPushInstructions } = loadInternal()
    const instructions = getPushInstructions('1.9.35')

    expect(instructions).toContain('git push\n')
    expect(instructions).toContain('git push origin v1.9.35')
    expect(instructions).toContain('Do not chain these commands in one shell line')
    expect(instructions).toContain('separate manual GitHub Actions -> Release workflow')
    expect(instructions).not.toContain('git push && git push origin')
  })

  it('requires an exact one-shot confirmation before creating a release tag', () => {
    const { assertReleaseBumpConfirmed } = loadInternal()

    expect(() =>
      assertReleaseBumpConfirmed({
        version: '1.9.59',
        env: {}
      })
    ).toThrow('CHERRY_STUDIO_PI_RELEASE_CONFIRM=v1.9.59')

    expect(() =>
      assertReleaseBumpConfirmed({
        version: '1.9.59',
        env: { CHERRY_STUDIO_PI_RELEASE_CONFIRM: 'v1.9.59' }
      })
    ).not.toThrow()

    expect(() =>
      assertReleaseBumpConfirmed({
        version: '1.9.60',
        env: { CHERRY_STUDIO_PI_RELEASE_CONFIRM: 'v1.9.59' }
      })
    ).toThrow('CHERRY_STUDIO_PI_RELEASE_CONFIRM=v1.9.60')
  })

  it('rejects release bumps from a dirty working tree', () => {
    const { assertCleanGitWorktree } = loadInternal()

    expect(() => assertCleanGitWorktree('')).not.toThrow()
    expect(() => assertCleanGitWorktree(' M src/main/index.ts\n?? scratch.txt')).toThrow(
      'Working tree must be clean before bumping a release version'
    )
  })
})
