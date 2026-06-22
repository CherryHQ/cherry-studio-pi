import type { AppModalApi, AppModalReturn } from '.'

type ModalGlobal = {
  modal?: AppModalApi
}

const noop = () => {}

function createFallbackModalReturn(confirmed = false): AppModalReturn {
  return Object.assign(Promise.resolve(confirmed), {
    destroy: noop,
    update: noop
  })
}

export const fallbackModal: AppModalApi = {
  confirm: () => createFallbackModalReturn(false),
  error: () => createFallbackModalReturn(false),
  info: () => createFallbackModalReturn(false),
  success: () => createFallbackModalReturn(false),
  warning: () => createFallbackModalReturn(false),
  warn: () => createFallbackModalReturn(false),
  destroyAll: noop
}

export function ensureWindowModalFallback(win: ModalGlobal | undefined = getWindowModalGlobal()): void {
  if (!win) {
    return
  }

  if (!win.modal) {
    win.modal = fallbackModal
  }
}

export function resetWindowModalFallbackIfCurrent(
  currentModal: AppModalApi | undefined,
  win: ModalGlobal | undefined = getWindowModalGlobal()
): void {
  if (win && currentModal && win.modal === currentModal) {
    win.modal = fallbackModal
  }
}

function getWindowModalGlobal(): ModalGlobal | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as ModalGlobal)
}
