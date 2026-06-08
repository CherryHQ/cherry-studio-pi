const { execFileSync } = require('child_process')
const fs = require('fs')
const semver = require('semver')

// 执行命令并返回输出
function exec(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function getPnpmExecutable(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function parseVersionArgs(args) {
  const versionType = args[0] || 'patch'
  const shouldPush = args.includes('push')

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

function getPushCommands(version) {
  return [
    ['git', ['push']],
    ['git', ['push', 'origin', `v${version}`]]
  ]
}

function getPushInstructions(version) {
  return `Changes are committed locally. Use "git push && git push origin v${version}" to push to remote.`
}

function runVersion(args = process.argv.slice(2)) {
  const { shouldPush, versionType } = parseVersionArgs(args)
  assertCleanGitWorktree()

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const { baseVersion, nextVersion } = resolveNextVersion(packageJson.version, versionType)

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

  if (shouldPush) {
    console.log('Pushing to remote...')
    for (const [command, commandArgs] of getPushCommands(newVersion)) {
      exec(command, commandArgs)
    }
    console.log('Pushed to remote.')
  } else {
    console.log(getPushInstructions(newVersion))
  }
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
  parseVersionArgs,
  extractVersionsFromGitRefs,
  getHighestVersion,
  selectKnownVersions,
  resolveNextVersion,
  assertCleanGitWorktree,
  getPushCommands,
  getPushInstructions,
  runVersion
}
