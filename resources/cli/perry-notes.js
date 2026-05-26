#!/usr/bin/env node
const { api, fail, parseArgs, print } = require('./lib/core')

const help = `Usage:
  perry-notes list [--json]
  perry-notes read <path> [--json]
  perry-notes search <query> [--limit 100] [--json]
  perry-notes create <name> [content] [--parent <dir>]
  perry-notes update <path> <content>
  perry-notes delete <path>
  perry-notes open`

async function main() {
  const { command, args, opts } = parseArgs(process.argv.slice(2))

  if (command === 'list') {
    const data = await api('/app/notes', { opts })
    return print(data, opts, (d) => `Root: ${d.root}\n${JSON.stringify(d.notes, null, 2)}`)
  }

  if (command === 'read') {
    if (!args[0]) throw new Error('Missing note path')
    return print(await api(`/app/notes/read?path=${encodeURIComponent(args[0])}`, { opts }), opts, (d) => d.content)
  }

  if (command === 'search') {
    if (!args[0]) throw new Error('Missing search query')
    const q = encodeURIComponent(args.join(' '))
    return print(await api(`/app/notes/search?q=${q}&limit=${Number(opts.limit || 100)}`, { opts }), opts)
  }

  if (command === 'create') {
    if (!args[0]) throw new Error('Missing note name')
    return print(
      await api('/app/notes', {
        method: 'POST',
        body: { name: args[0], content: args.slice(1).join(' '), parent: opts.parent },
        opts
      }),
      opts
    )
  }

  if (command === 'update') {
    if (!args[0]) throw new Error('Missing note path')
    return print(await api('/app/notes', { method: 'PUT', body: { path: args[0], content: args.slice(1).join(' ') }, opts }), opts)
  }

  if (command === 'delete') {
    if (!args[0]) throw new Error('Missing note path')
    return print(await api(`/app/notes?path=${encodeURIComponent(args[0])}`, { method: 'DELETE', opts }), opts)
  }

  if (command === 'open') {
    return print(await api('/app/navigate', { method: 'POST', body: { route: '/notes' }, opts }), opts, () => 'Opened notes')
  }

  console.log(help)
}

main().catch(fail)
