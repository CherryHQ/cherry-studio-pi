#!/usr/bin/env node
const { api, fail, parseArgs, print } = require('./lib/core')

const help = `Usage:
  perry-painting providers [--json]
  perry-painting list [namespace] [--json]
  perry-painting default [provider]
  perry-painting open`

async function main() {
  const { command, args, opts } = parseArgs(process.argv.slice(2))

  if (command === 'providers') {
    const data = await api('/app/paintings/providers', { opts })
    return print(data, opts, (d) => `Default: ${d.defaultProvider}\n${d.namespaces.join('\n')}`)
  }

  if (command === 'list') {
    const namespace = args[0] ? `?namespace=${encodeURIComponent(args[0])}` : ''
    return print(await api(`/app/paintings${namespace}`, { opts }), opts)
  }

  if (command === 'default') {
    if (!args[0]) return print(await api('/app/paintings/providers', { opts }), opts)
    return print(
      await api('/app/paintings/default-provider', { method: 'PATCH', body: { provider: args[0] }, opts }),
      opts
    )
  }

  if (command === 'open') {
    return print(await api('/app/navigate', { method: 'POST', body: { route: '/paintings' }, opts }), opts, () => 'Opened painting')
  }

  console.log(help)
}

main().catch(fail)
