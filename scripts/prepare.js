const { execFileSync } = require('node:child_process')

function run(command, args, options = {}) {
  try {
    execFileSync(command, args, { stdio: 'inherit' })
  } catch (error) {
    if (options.optional) {
      console.warn(`[prepare] Optional command failed: ${command} ${args.join(' ')}`)
      return
    }

    throw error
  }
}

run('git', ['config', 'blame.ignoreRevsFile', '.git-blame-ignore-revs'], { optional: true })

if (process.env.CI) {
  console.log('[prepare] CI detected; skipping prek install')
  process.exit(0)
}

run('prek', ['install'])
