import { Button } from '@cherrystudio/ui'
import MarkdownEditor from '@renderer/components/MarkdownEditor'
import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from './primitives/ProviderSettingsDrawer'
import { drawerClasses } from './primitives/ProviderSettingsPrimitives'

interface ShowParams {
  providerId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: FC<Props> = ({ providerId, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { provider, updateProvider } = useProvider(providerId)
  const [notes, setNotes] = useState<string>(provider?.settings?.notes || '')
  const [edited, setEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const resolvedRef = useRef(false)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (edited) {
      return
    }

    setNotes(provider?.settings?.notes || '')
  }, [edited, provider?.settings?.notes])

  const handleSave = async () => {
    if (savingRef.current || !provider) {
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      await updateProvider({ providerSettings: { ...provider.settings, notes } })
      if (!mountedRef.current) {
        return
      }

      setOpen(false)
      resolvedRef.current = true
      resolve({})
    } catch {
      if (mountedRef.current) {
        window.toast.error(t('blocks.edit.save.failed.label'))
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current && !resolvedRef.current) {
        setSaving(false)
      }
    }
  }

  const onCancel = () => {
    if (savingRef.current || resolvedRef.current) {
      return
    }

    resolvedRef.current = true
    setOpen(false)
    resolve({})
  }

  const footer = (
    <div className={drawerClasses.footer}>
      <Button variant="outline" disabled={saving} onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button loading={saving} disabled={saving || !provider} onClick={() => void handleSave()}>
        {t('common.save')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      title={t('settings.provider.notes.title')}
      open={open}
      onClose={onCancel}
      footer={footer}
      bodyClassName="flex min-h-0 flex-1 flex-col px-5 py-4">
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          value={notes}
          onChange={(value) => {
            setEdited(true)
            setNotes(value)
          }}
          placeholder={t('settings.provider.notes.placeholder')}
          height="400px"
        />
      </div>
    </ProviderSettingsDrawer>
  )
}

export default class ModelNotesPopup {
  static hide() {
    TopView.hide('ModelNotesPopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'ModelNotesPopup'
      )
    })
  }
}
