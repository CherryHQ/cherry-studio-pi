import { describe, expect, it } from 'vitest'

import { resolveTaskTextFieldBlur } from '../taskTextFieldGuards'

describe('resolveTaskTextFieldBlur', () => {
  it('does nothing when the draft is already equal to the persisted value', () => {
    expect(resolveTaskTextFieldBlur('Daily summary', 'Daily summary')).toEqual({ action: 'noop' })
  })

  it('resets blank edits instead of leaving an unsaved empty field visible', () => {
    expect(resolveTaskTextFieldBlur('   \n  ', 'Daily summary')).toEqual({
      action: 'reset',
      value: 'Daily summary'
    })
  })

  it('resets whitespace-only differences without sending a redundant update', () => {
    expect(resolveTaskTextFieldBlur('  Daily summary\n', 'Daily summary')).toEqual({
      action: 'reset',
      value: 'Daily summary'
    })
  })

  it('saves meaningful edits using the existing trimmed task text contract', () => {
    expect(resolveTaskTextFieldBlur('  Prepare release notes\n', 'Daily summary')).toEqual({
      action: 'save',
      value: 'Prepare release notes'
    })
  })
})
