import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewApiBatchAddModelPopup from '../NewApiBatchAddModelPopup'

const createModelsMock = vi.fn()
const updateProviderMock = vi.fn()
const useModelsMock = vi.fn()
const showMock = vi.fn()
const hideMock = vi.fn()

let shownElement: ReactNode = null

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, loading, onClick, ...props }: any) => (
    <button type="button" disabled={disabled || loading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children, open }: any) => (open ? <div data-testid="batch-model-dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    show: (element: ReactNode, id: string) => {
      shownElement = element
      showMock(element, id)
    },
    hide: (id: string) => hideMock(id)
  }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelMutations: () => ({
    createModels: (...args: any[]) => createModelsMock(...args)
  }),
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderMutations: () => ({
    updateProvider: (...args: any[]) => updateProviderMock(...args)
  })
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('NewApiBatchAddModelPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shownElement = null
    ;(window as any).toast = {
      error: vi.fn()
    }

    useModelsMock.mockReturnValue({ models: [] })
    updateProviderMock.mockResolvedValue(undefined)
  })

  it('ignores a finished batch add after the popup unmounts', async () => {
    const runningCreate = deferred<void>()
    createModelsMock.mockReturnValueOnce(runningCreate.promise)
    const resolveSpy = vi.fn()

    const popupPromise = NewApiBatchAddModelPopup.show({
      title: 'Batch add',
      provider: { id: 'new-api', name: 'New API', isEnabled: true } as any,
      batchModels: [
        {
          id: 'new-api::alpha-model',
          providerId: 'new-api',
          name: 'Alpha Model',
          group: 'Alpha',
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
        } as any
      ]
    })
    void popupPromise.then(resolveSpy)

    expect(showMock).toHaveBeenCalledWith(expect.anything(), 'NewApiBatchAddModelPopup')

    const { unmount } = render(<>{shownElement}</>)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.models.add.add_model' }))
    })

    expect(createModelsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        providerId: 'new-api',
        modelId: 'alpha-model',
        name: 'Alpha Model',
        group: 'Alpha',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
    ])

    unmount()

    await act(async () => {
      runningCreate.resolve(undefined)
      await runningCreate.promise
    })

    expect(resolveSpy).not.toHaveBeenCalled()
    expect(hideMock).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
