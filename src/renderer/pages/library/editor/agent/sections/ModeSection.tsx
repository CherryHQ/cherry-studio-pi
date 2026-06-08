import { Button } from '@cherrystudio/ui'
import type { AgentType } from '@shared/data/types/agent'
import { Check, Sparkles, Zap } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentFormState } from '../descriptor'

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

const MODE_OPTIONS: Array<{
  type: AgentType
  icon: typeof Zap
  titleKey: string
  descKey: string
}> = [
  {
    type: 'pi',
    icon: Zap,
    titleKey: 'library.config.agent.field.mode.option.standard.title',
    descKey: 'library.config.agent.field.mode.option.standard.desc'
  },
  {
    type: 'claude-code',
    icon: Sparkles,
    titleKey: 'library.config.agent.field.mode.option.enhanced.title',
    descKey: 'library.config.agent.field.mode.option.enhanced.desc'
  }
]

const ModeSection: FC<Props> = ({ form, onChange }) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.mode.title')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.mode.desc')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {MODE_OPTIONS.map((option) => {
          const Icon = option.icon
          const selected = form.type === option.type
          return (
            <Button
              key={option.type}
              type="button"
              variant="ghost"
              aria-pressed={selected}
              onClick={() => onChange({ type: option.type })}
              className={`h-full min-h-[132px] items-stretch justify-start rounded-lg border p-0 text-left font-normal shadow-none transition-all hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50 ${
                selected
                  ? 'border-primary/45 bg-primary/5 text-foreground ring-1 ring-primary/20'
                  : 'border-border/50 bg-background text-foreground'
              }`}>
              <div className="flex h-full w-full flex-col gap-3 p-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                      selected ? 'bg-primary/10 text-primary' : 'bg-accent text-muted-foreground'
                    }`}>
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{t(option.titleKey)}</div>
                  </div>
                  {selected ? <Check size={16} className="shrink-0 text-primary" strokeWidth={2} /> : null}
                </div>
                <p className="whitespace-normal text-muted-foreground/80 text-xs leading-5">{t(option.descKey)}</p>
              </div>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default ModeSection
