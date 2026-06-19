import { describe, expect, it } from 'vitest'

import {
  formStateToTrigger,
  isTaskCreateFormSubmittable,
  parseScheduleDate,
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
})
