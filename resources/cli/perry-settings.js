#!/usr/bin/env node
const { api, fail, parseArgs, parseValue, print } = require('./lib/core')

const help = `Usage:
  perry-settings sections [--json]
  perry-settings get [path] [--json]
  perry-settings set <path> <json-value>
  perry-settings open [section-id|route]`

async function main() {
  const { command, args, opts } = parseArgs(process.argv.slice(2))

  if (command === 'sections') {
    const data = await api('/app/settings/sections', { opts })
    return print(data, opts, (d) => d.sections.map((s) => `${s.id}\t${s.route}\t${s.label}`).join('\n'))
  }

  if (command === 'get') {
    const target = args[0]
    const path = target ? `/app/settings/value?path=${encodeURIComponent(target)}` : '/app/settings'
    return print(await api(path, { opts }), opts)
  }

  if (command === 'set') {
    if (!args[0]) throw new Error('Missing setting path')
    return print(
      await api('/app/settings/value', {
        method: 'PATCH',
        body: { path: args[0], value: parseValue(args[1]) },
        opts
      }),
      opts
    )
  }

  if (command === 'open') {
    const target = args[0] || 'provider'
    const body = target.startsWith('/') ? { route: target } : { section: target }
    return print(await api('/app/settings/open', { method: 'POST', body, opts }), opts, () => `Opened ${target}`)
  }

  console.log(help)
}

main().catch(fail)
