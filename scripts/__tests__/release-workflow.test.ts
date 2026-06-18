import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('release workflow safety', () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/release.yml')
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')

  it('keeps installer publishing manual-only', () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m)
    expect(workflow).not.toMatch(/^\s*push\s*:\s*$/m)
    expect(workflow).not.toMatch(/^\s*on\s*:\s*\[[^\]]*\bpush\b[^\]]*\]/m)
  })

  it('keeps the release job guarded against non-manual events', () => {
    expect(workflow).toContain(
      "github.repository == 'CherryHQ/cherry-studio-pi' && github.event_name == 'workflow_dispatch'"
    )
  })

  it('refuses to overwrite an existing release unless explicitly requested', () => {
    expect(workflow).toContain('replace_existing:')
    expect(workflow).toContain('gh release view "$TAG"')
    expect(workflow).toContain('Refusing to rebuild or overwrite an existing release')
    expect(workflow).toContain('overwrite_files: ${{ needs.prepare.outputs.replace_existing }}')
  })
})
