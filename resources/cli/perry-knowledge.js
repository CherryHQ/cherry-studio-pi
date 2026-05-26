#!/usr/bin/env node
const { api, fail, parseArgs, print } = require('./lib/core')

const help = `Usage:
  perry-knowledge list [--json]
  perry-knowledge get <base-id> [--json]
  perry-knowledge search <query> [--base <base-id>] [--count 5] [--json]
  perry-knowledge open`

async function main() {
  const { command, args, opts } = parseArgs(process.argv.slice(2))

  if (command === 'list') {
    const data = await api('/knowledge-bases', { opts })
    return print(data, opts, (d) => (d.knowledge_bases || []).map((b) => `${b.id}\t${b.name}`).join('\n') || 'No knowledge bases')
  }

  if (command === 'get') {
    if (!args[0]) throw new Error('Missing knowledge base id')
    return print(await api(`/knowledge-bases/${encodeURIComponent(args[0])}`, { opts }), opts)
  }

  if (command === 'search') {
    if (!args[0]) throw new Error('Missing search query')
    const body = {
      query: args.join(' '),
      document_count: Number(opts.count || 5),
      knowledge_base_ids: opts.base ? [String(opts.base)] : undefined
    }
    return print(await api('/knowledge-bases/search', { method: 'POST', body, opts }), opts)
  }

  if (command === 'open') {
    return print(await api('/app/navigate', { method: 'POST', body: { route: '/knowledge' }, opts }), opts, () => 'Opened knowledge base')
  }

  console.log(help)
}

main().catch(fail)
