const { execFileSync } = require('child_process')
const fs = require('fs')
const semver = require('semver')

const RELEASE_PUSH_CONFIRM_ENV = 'CHERRY_STUDIO_PI_RELEASE_CONFIRM'
const EXPECTED_RELEASE_REPOSITORY = 'CherryHQ/cherry-studio-pi'

// 执行命令并返回输出
function exec(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function getPnpmExecutable(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function normalizeGitHubRepositorySlug(remoteUrl) {
  const value = typeof remoteUrl === 'string' ? remoteUrl.trim() : ''
  if (!value) return null

  const scpLikeMatch = value.match(/^git@github\.com:(.+?)(?:\.git)?$/i)
  if (scpLikeMatch) {
    return scpLikeMatch[1].replace(/\.git$/i, '').toLowerCase()
  }

  try {
    const parsed = new URL(value)
    if (!/^github\.com$/i.test(parsed.hostname)) return null
    return parsed.pathname
      .replace(/^\/+/, '')
      .replace(/\.git$/i, '')
      .toLowerCase()
  } catch {
    return null
  }
}

function assertCherryStudioPiOrigin(originUrl = exec('git', ['remote', 'get-url', 'origin'])) {
  const actualRepository = normalizeGitHubRepositorySlug(originUrl)
  const expectedRepository = EXPECTED_RELEASE_REPOSITORY.toLowerCase()

  if (actualRepository !== expectedRepository) {
    throw new Error(
      [
        `Refusing to bump a Cherry Studio Pi release outside ${EXPECTED_RELEASE_REPOSITORY}.`,
        `Current origin is ${originUrl || 'unknown'}.`,
        'This prevents accidentally creating Pi release tags in Cherry Studio or another checkout.'
      ].join(' ')
    )
  }
}

function parseVersionArgs(args) {
  const versionType = args[0] || 'patch'
  const shouldPush = args.includes('push')

  if (shouldPush) {
    throw new Error(
      [
        'Local release tag pushing is disabled.',
        'Create or reuse the exact release tag through the GitHub Actions Release workflow instead.',
        'This prevents one local command from accidentally publishing multiple GitHub Releases.'
      ].join(' ')
    )
  }

  // 验证版本类型
  if (!['patch', 'minor', 'major'].includes(versionType)) {
    throw new Error('Invalid version type. Use patch, minor, or major.')
  }

  return { shouldPush, versionType }
}

function normalizeVersion(version) {
  const cleaned = semver.clean(version)

  if (!cleaned) {
    throw new Error(`Invalid semantic version: ${version}`)
  }

  return cleaned
}

function extractVersionsFromGitRefs(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const ref = line.split(/\s+/).pop() || line
      return ref
        .replace(/^refs\/tags\//, '')
        .replace(/\^\{\}$/, '')
        .replace(/^v/, '')
    })
    .filter((version) => semver.valid(version))
}

function getHighestVersion(versions) {
  const normalizedVersions = versions.map(normalizeVersion)
  const uniqueVersions = [...new Set(normalizedVersions)]

  if (uniqueVersions.length === 0) {
    throw new Error('No valid semantic versions found')
  }

  return uniqueVersions.sort(semver.rcompare)[0]
}

function selectKnownVersions(packageVersion, remoteVersions, localVersions) {
  const sourceVersions = remoteVersions.length > 0 ? remoteVersions : localVersions
  return [packageVersion, ...sourceVersions]
}

function collectKnownVersions(packageVersion) {
  let remoteVersions = []
  let localVersions = []

  try {
    remoteVersions = extractVersionsFromGitRefs(exec('git', ['ls-remote', '--tags', 'origin', 'v*']))
  } catch {
    // Remote tags are authoritative when available; local tags are only an offline fallback.
  }

  try {
    localVersions = extractVersionsFromGitRefs(exec('git', ['tag', '--list', 'v*']))
  } catch {
    // The release script should still work offline when local tags are available.
  }

  return selectKnownVersions(packageVersion, remoteVersions, localVersions)
}

function resolveNextVersion(packageVersion, versionType, knownVersions = collectKnownVersions(packageVersion)) {
  const baseVersion = getHighestVersion(knownVersions)
  const nextVersion = semver.inc(baseVersion, versionType)

  if (!nextVersion) {
    throw new Error(`Unable to bump version ${baseVersion} as ${versionType}`)
  }

  return { baseVersion, nextVersion }
}

function assertCleanGitWorktree(statusOutput = exec('git', ['status', '--porcelain'])) {
  if (statusOutput.trim()) {
    throw new Error('Working tree must be clean before bumping a release version.')
  }
}

function normalizeReleaseConfirmation(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function assertReleaseBumpConfirmed({ version, env = process.env }) {
  const expectedTag = `v${version}`
  const actualConfirmation = normalizeReleaseConfirmation(env[RELEASE_PUSH_CONFIRM_ENV])

  if (actualConfirmation !== expectedTag) {
    throw new Error(
      [
        `Refusing to create release ${expectedTag} without an exact confirmation.`,
        `Set ${RELEASE_PUSH_CONFIRM_ENV}=${expectedTag} for this one release bump only.`,
        'This guard prevents accidental local tags, pushed tags, or repeated patch releases from a stale command.'
      ].join(' ')
    )
  }
}

function getPushInstructions(version) {
  return [
    `Changes are committed locally and tagged as v${version}.`,
    'Push the commit and tag only when you are ready to expose the tag to CI/history:',
    `git push && git push origin v${version}`,
    'Publishing installers is a separate manual GitHub Actions -> Release workflow step.'
  ].join('\n')
}

function runVersion(args = process.argv.slice(2)) {
  const { versionType } = parseVersionArgs(args)
  assertCleanGitWorktree()
  assertCherryStudioPiOrigin()

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const { baseVersion, nextVersion } = resolveNextVersion(packageJson.version, versionType)
  assertReleaseBumpConfirmed({ version: nextVersion })

  // 更新版本
  exec(getPnpmExecutable(), ['version', nextVersion, '--no-git-tag-version'])

  // 读取更新后的 package.json 获取新版本号
  const updatedPackageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const newVersion = updatedPackageJson.version

  // Git 操作
  exec('git', ['add', 'package.json'])
  exec('git', ['commit', '-m', `chore(version): ${newVersion}`])
  exec('git', ['tag', '-a', `v${newVersion}`, '-m', `Version ${newVersion}`])

  console.log(`Version bumped from ${baseVersion} to ${newVersion}`)

  console.log(getPushInstructions(newVersion))
}

if (require.main === module) {
  try {
    runVersion()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

exports._internal = {
  getPnpmExecutable,
  normalizeGitHubRepositorySlug,
  assertCherryStudioPiOrigin,
  parseVersionArgs,
  extractVersionsFromGitRefs,
  getHighestVersion,
  selectKnownVersions,
  resolveNextVersion,
  assertCleanGitWorktree,
  assertReleaseBumpConfirmed,
  getPushInstructions,
  runVersion
}
