// import { loggerService } from '@logger'
import { Box } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import AppModalProvider from '@renderer/components/AppModal'
import { useAgentSessionAutoRenameSync } from '@renderer/hooks/agents/useSession'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { useTopicAutoRenameSync } from '@renderer/hooks/useTopic'
import { ipcApi } from '@renderer/ipc'
import type { PropsWithChildren } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToastProvider, useToasts } from './toast'

type TopViewShowPayload = {
  element: React.FC | React.ReactNode
  id: string
}

const noopPop = () => {}
const noopShow = ({ element, id }: TopViewShowPayload) => {
  void element
  id
}
const noopHide = (id: string) => {
  id
}
const noopHideAll = () => {}

let onPop = noopPop
let onShow = noopShow
let onHide = noopHide
let onHideAll = noopHideAll

interface Props {
  children?: React.ReactNode
}

type ElementItem = {
  id: string
  element: React.FC | React.ReactNode
}

// const logger = loggerService.withContext('TopView')

const TopViewContent: React.FC<Props> = ({ children }) => {
  const [elements, setElements] = useState<ElementItem[]>([])
  const elementsRef = useRef<ElementItem[]>([])
  elementsRef.current = elements

  const [exitFullscreenPref] = usePreference('shortcut.app.fullscreen.exit')
  const enableQuitFullScreen = exitFullscreenPref?.enabled !== false

  useAppInit()
  useTopicAutoRenameSync()
  useAgentSessionAutoRenameSync()

  const toast = useToasts()

  useEffect(() => {
    window.toast = toast
  }, [toast])

  const handlePop = useCallback(() => {
    const views = [...elementsRef.current]
    views.pop()
    elementsRef.current = views
    setElements(elementsRef.current)
  }, [])

  const handleShow = useCallback(({ element, id }: ElementItem) => {
    const next = elementsRef.current.filter((el) => el.id !== id).concat([{ element, id }])
    elementsRef.current = next
    setElements(next)
  }, [])

  const handleHide = useCallback((id: string) => {
    elementsRef.current = elementsRef.current.filter((el) => el.id !== id)
    setElements(elementsRef.current)
  }, [])

  const handleHideAll = useCallback(() => {
    setElements([])
    elementsRef.current = []
  }, [])

  useEffect(() => {
    onPop = handlePop
    onShow = handleShow
    onHide = handleHide
    onHideAll = handleHideAll

    return () => {
      if (onPop === handlePop) onPop = noopPop
      if (onShow === handleShow) onShow = noopShow
      if (onHide === handleHide) onHide = noopHide
      if (onHideAll === handleHideAll) onHideAll = noopHideAll
    }
  }, [handleHide, handleHideAll, handlePop, handleShow])

  const FullScreenContainer: React.FC<PropsWithChildren> = useCallback(({ children }) => {
    return (
      <Box className="topview-fullscreen-container absolute h-full w-full flex-1">
        <Box className="topview-backdrop absolute h-full w-full" />
        {children}
      </Box>
    )
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enableQuitFullScreen) return

      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        void ipcApi.request('window.set_full_screen', false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enableQuitFullScreen])

  return (
    <>
      {children}
      <AppModalProvider
        onReady={(modal) => {
          window.modal = modal
        }}
      />
      {elements.map(({ element: Element, id }) => (
        <FullScreenContainer key={`TOPVIEW_${id}`}>
          {typeof Element === 'function' ? <Element /> : Element}
        </FullScreenContainer>
      ))}
    </>
  )
}

const TopViewContainer: React.FC<Props> = ({ children }) => {
  const { t } = useTranslation()
  const toastLabels = useMemo(
    () => ({
      close: t('common.close'),
      error: t('common.error'),
      errorDescription: t('error.unknown'),
      loading: t('common.loading'),
      success: t('common.success')
    }),
    [t]
  )

  return (
    <ToastProvider labels={toastLabels}>
      <TopViewContent>{children}</TopViewContent>
    </ToastProvider>
  )
}

export const TopView = {
  show: (element: React.FC | React.ReactNode, id: string) => onShow({ element, id }),
  hide: (id: string) => onHide(id),
  clear: () => onHideAll(),
  pop: () => onPop()
}

export default TopViewContainer
