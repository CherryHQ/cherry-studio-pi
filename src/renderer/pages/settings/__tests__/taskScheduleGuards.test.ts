import { describe, expect, it } from 'vitest'

import {
  formStateToTrigger,
  isTaskCreateFormSubmittable,
  parseScheduleDate,
  resolveTaskScheduleBlur,
  triggerToFormState
} from '../taskScheduleGuards'

describe('task schedule guards', () => {
  it('round-trips supported task trigger kinds into form state', () => {
    expect(triggerToFormState({ kind: 'cron', expr: '0 9 * * *' })).toEqual({
      kind: 'cron',
      value: '0 9 * * *'
    })
    expect(triggerToFormState({ kind: 'interval', ms: 30 * 60_000 })).toEqual({
      kind: 'interval',
      value: '30'
    })
    expect(triggerToFormState({ kind: 'once', at: 1780058147577 })).toEqual({
      kind: 'once',
      value: new Date(1780058147577).toISOString()
    })
  })

  it('rejects empty or non-positive schedule values', () => {
    expect(formStateToTrigger('cron', '   ')).toBeNull()
    expect(formStateToTrigger('interval', '0')).toBeNull()
    expect(formStateToTrigger('interval', '-1')).toBeNull()
    expect(formStateToTrigger('interval', '1.5')).toBeNull()
    expect(formStateToTrigger('interval', '1abc')).toBeNull()
    expect(formStateToTrigger('interval', '1e2')).toBeNull()
    expect(formStateToTrigger('once', 'not-a-date')).toBeNull()
  })

  it('parses valid schedule values for submission', () => {
    expect(formStateToTrigger('cron', '  0 9 * * *  ')).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(formStateToTrigger('interval', '15')).toEqual({ kind: 'interval', ms: 15 * 60_000 })
    expect(formStateToTrigger('once', '2026-06-20T08:00:00.000Z')).toEqual({
      kind: 'once',
      at: Date.parse('2026-06-20T08:00:00.000Z')
    })
  })

  it('keeps the create form disabled until the current schedule can produce a trigger', () => {
    const base = {
      agentId: 'agent-1',
      name: 'Morning report',
      prompt: 'Summarize yesterday',
      scheduleKind: 'interval' as const
    }

    expect(isTaskCreateFormSubmittable({ ...base, scheduleValue: '0' })).toBe(false)
    expect(isTaskCreateFormSubmittable({ ...base, scheduleValue: '15' })).toBe(true)
    expect(isTaskCreateFormSubmittable({ ...base, agentId: null, scheduleValue: '15' })).toBe(false)
    expect(isTaskCreateFormSubmittable({ ...base, name: ' ', scheduleValue: '15' })).toBe(false)
    expect(isTaskCreateFormSubmittable({ ...base, prompt: ' ', scheduleValue: '15' })).toBe(false)
  })

  it('returns undefined for empty or invalid date picker values', () => {
    expect(parseScheduleDate('')).toBeUndefined()
    expect(parseScheduleDate('not-a-date')).toBeUndefined()
    expect(parseScheduleDate('2026-06-20T08:00:00.000Z')).toEqual(new Date('2026-06-20T08:00:00.000Z'))
  })

  it('resolves schedule blur edits without leaving unsaved invalid values visible', () => {
    const current = { kind: 'interval' as const, ms: 10 * 60_000 }

    expect(resolveTaskScheduleBlur('interval', '20', current)).toEqual({
      action: 'save',
      trigger: { kind: 'interval', ms: 20 * 60_000 },
      state: { kind: 'interval', value: '20' }
    })
    expect(resolveTaskScheduleBlur('interval', '0', current)).toEqual({
      action: 'reset',
      state: { kind: 'interval', value: '10' }
    })
    expect(resolveTaskScheduleBlur('interval', '010', current)).toEqual({
      action: 'reset',
      state: { kind: 'interval', value: '10' }
    })
    expect(resolveTaskScheduleBlur('cron', '   ', current)).toEqual({
      action: 'reset',
      state: { kind: 'interval', value: '10' }
    })
    expect(resolveTaskScheduleBlur('cron', '  0 9 * * *  ', current)).toEqual({
      action: 'save',
      trigger: { kind: 'cron', expr: '0 9 * * *' },
      state: { kind: 'cron', value: '0 9 * * *' }
    })
  })
})
