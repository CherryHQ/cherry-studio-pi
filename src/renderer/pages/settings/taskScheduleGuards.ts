import type { Trigger } from '@shared/data/api/schemas/jobs'

export type ScheduleKind = 'cron' | 'interval' | 'once'

export function parseScheduleDate(value: string) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function triggerToFormState(trigger: Trigger): { kind: ScheduleKind; value: string } {
  switch (trigger.kind) {
    case 'cron':
      return { kind: 'cron', value: trigger.expr }
    case 'interval':
      // Wire stores ms; UI shows minutes -- round to keep "every 30m" stable on round-trip.
      return { kind: 'interval', value: String(Math.max(1, Math.round(trigger.ms / 60_000))) }
    case 'once':
      return { kind: 'once', value: new Date(trigger.at).toISOString() }
  }
}

export function formStateToTrigger(kind: ScheduleKind, value: string): Trigger | null {
  const trimmed = value.trim()
  if (kind === 'cron') {
    if (!trimmed) return null
    return { kind: 'cron', expr: trimmed }
  }
  if (kind === 'interval') {
    if (!/^\d+$/.test(trimmed)) return null
    const minutes = Number(trimmed)
    if (!Number.isSafeInteger(minutes) || minutes <= 0) return null
    return { kind: 'interval', ms: minutes * 60_000 }
  }
  const at = Date.parse(trimmed)
  if (!Number.isFinite(at)) return null
  return { kind: 'once', at }
}

export function isTaskCreateFormSubmittable(input: {
  agentId: string | null
  name: string
  prompt: string
  scheduleKind: ScheduleKind
  scheduleValue: string
}) {
  return Boolean(
    input.agentId &&
      input.name.trim() &&
      input.prompt.trim() &&
      formStateToTrigger(input.scheduleKind, input.scheduleValue)
  )
}
