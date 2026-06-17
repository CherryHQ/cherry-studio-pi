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
    expect(parseVersionArgs(['minor', 'push'])).toEqual({ shouldPush: true, versionType: 'minor' })
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

  it('pushes only the newly created release tag', () => {
    const { getPushCommands, getPushInstructions } = loadInternal()

    expect(getPushCommands('1.9.35')).toEqual([
      ['git', ['push']],
      ['git', ['push', 'origin', 'v1.9.35']]
    ])
    expect(getPushInstructions('1.9.35')).toContain('git push origin v1.9.35')
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
