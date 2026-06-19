import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

function getWorkflowEventNames(workflow: string): string[] {
  const parsed = parse(workflow) as { on?: unknown } | null
  const events = parsed?.on

  if (typeof events === 'string') {
    return [events]
  }

  if (Array.isArray(events)) {
    return events.filter((event): event is string => typeof event === 'string')
  }

  if (events && typeof events === 'object') {
    return Object.keys(events)
  }

  return []
}

describe('release workflow safety', () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/release.yml')
  const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
  const prepareReleaseSkillPath = path.resolve(process.cwd(), '.agents/skills/prepare-release/SKILL.md')
  const prepareReleaseSkill = fs.readFileSync(prepareReleaseSkillPath, 'utf8').replace(/\r\n/g, '\n')

  it('keeps installer publishing manual-only', () => {
    expect(getWorkflowEventNames(workflow)).toEqual(['workflow_dispatch'])
  })

  it('keeps the release job guarded against non-manual events', () => {
    expect(workflow).toContain(
      "github.repository == 'CherryHQ/cherry-studio-pi' && github.event_name == 'workflow_dispatch'"
    )
  })

  it('requires an explicit repeated tag confirmation for manual publishing', () => {
    expect(workflow).toContain('confirm_tag:')
    expect(workflow).toContain('CONFIRM_TAG="${{ github.event.inputs.confirm_tag }}"')
    expect(workflow).toContain('Release tag confirmation mismatch')
  })

  it('refuses to overwrite an existing release unless explicitly requested', () => {
    expect(workflow).toContain('replace_existing:')
    expect(workflow).toContain('gh release view "$TAG"')
    expect(workflow).toContain('Refusing to rebuild or overwrite an existing release')
    expect(workflow).toContain('overwrite_files: ${{ needs.prepare.outputs.replace_existing }}')
  })

  it('serializes app releases across different tags', () => {
    expect(workflow).toContain('group: app-release-${{ github.repository }}')
    expect(workflow).not.toContain('group: release-${{ github.event.inputs.tag }}')
  })

  it('blocks rapid consecutive releases and drafts unless explicitly allowed', () => {
    expect(workflow).toContain('allow_close_release:')
    expect(workflow).toContain('CLOSE_RELEASE_WINDOW_MINUTES=120')
    expect(workflow).not.toContain('.filter((release) => !release.isDraft)')
    expect(workflow).toContain(
      'Refusing to publish ${currentTag} within ${windowMinutes} minutes of another release or draft'
    )
  })

  it('does not suggest chained version commit and tag pushes', () => {
    expect(workflow).toContain('Push the version commit first:')
    expect(workflow).toContain('Push the annotated tag only after confirming this tag should be available remotely:')
    expect(workflow).toContain('Pushing the tag does not publish installers; it only makes the tag selectable here.')
    expect(workflow).not.toContain('git push && git push origin')
    expect(prepareReleaseSkill).not.toContain('git push && git push origin')
  })

  it('keeps the release preparation skill aligned with manual one-shot publishing', () => {
    expect(prepareReleaseSkill).toContain('publish exactly once through the manual GitHub Actions Release workflow')
    expect(prepareReleaseSkill).toContain('Never publish a second release for the same user request')
    expect(prepareReleaseSkill).toContain('**`release.yml`** is manual-only')
    expect(prepareReleaseSkill).toContain('Do not chain these commands in one shell line')
    expect(prepareReleaseSkill).not.toContain('Merge to trigger release build')
    expect(prepareReleaseSkill).not.toContain('automatically triggers:\n- **`release.yml`**')
  })
})
