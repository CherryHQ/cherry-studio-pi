import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddModelDrawer from '../ModelDrawer/AddModelDrawer'
import EditModelDrawer from '../ModelDrawer/EditModelDrawer'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const createModelMock = vi.fn()
const deleteModelMock = vi.fn()
const updateModelMock = vi.fn()
const updateProviderMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, onClick, type = 'button', form, loading, disabled, ...props }: any) => (
      <button
        type={type}
        form={form}
        disabled={disabled || loading}
        data-loading={loading}
        onClick={onClick}
        {...props}>
        {children}
      </button>
    ),
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
        {String(checked)}
      </button>
    ),
    DescriptionSwitch: ({ label, description, checked, onCheckedChange, ...props }: any) => (
      <label>
        <span>{label}</span>
        {description ? <span>{description}</span> : null}
        <button
          type="button"
          role="switch"
          aria-label={label}
          aria-checked={checked}
          onClick={() => onCheckedChange(!checked)}
          {...props}>
          {String(checked)}
        </button>
      </label>
    ),
    WarnTooltip: () => <span>warn</span>
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    createModel: (...args: any[]) => createModelMock(...args),
    deleteModel: (...args: any[]) => deleteModelMock(...args),
    updateModel: (...args: any[]) => updateModelMock(...args)
  })
}))

vi.mock('@renderer/components/Tags/Model', () => ({
  VisionTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      vision
    </button>
  ),
  WebSearchTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      web_search
    </button>
  ),
  ReasoningTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      reasoning
    </button>
  ),
  ToolsCallingTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      function_calling
    </button>
  ),
  RerankerTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      rerank
    </button>
  ),
  EmbeddingTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      embedding
    </button>
  )
}))

vi.mock('@renderer/components/Icons/CopyIcon', () => ({
  default: () => <span>copy-icon</span>
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, children, footer }: any) =>
    open ? (
      <div data-testid="provider-settings-drawer">
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null
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

describe('Model drawers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api.getAppInfo = vi.fn().mockResolvedValue({})
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
    ;(window as any).modal = { confirm: vi.fn() }

    useModelsMock.mockReturnValue({ models: [] })
    updateProviderMock.mockResolvedValue(undefined)
  })

  it('renders the legacy add drawer without the inner panel shell and submits through the local drawer form', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: false },
      updateProvider: updateProviderMock
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-add-drawer-content')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.add.endpoint_type.tooltip')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'alpha-model' }
    })
    fireEvent.change(screen.getByLabelText('settings.models.add.model_name.label'), {
      target: { value: 'Alpha Model' }
    })
    fireEvent.change(screen.getByLabelText('settings.models.add.group_name.label'), {
      target: { value: 'Alpha' }
    })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'alpha-model',
        name: 'Alpha Model',
        group: 'Alpha',
        endpointTypes: undefined
      })
    )
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
  })

  it('keeps the add drawer open when the provider cannot be enabled after adding models', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: false },
      updateProvider: updateProviderMock
    })
    updateProviderMock.mockRejectedValueOnce(new Error('enable failed'))
    const onClose = vi.fn()

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'alpha-model' }
    })

    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', modelId: 'alpha-model' })
    )
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    expect(window.toast.error).toHaveBeenCalledWith('settings.models.add.provider_enable_failed')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('provider-settings-model-add-drawer-content')).toBeInTheDocument()
  })

  it('renders the new-api add drawer with the shared select surface and keeps endpoint type in create payload', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'new-api', name: 'New API', isEnabled: true },
      updateProvider: updateProviderMock
    })

    render(<AddModelDrawer providerId="new-api" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-endpoint-type-field')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'claude-4-sonnet' }
    })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'new-api',
        modelId: 'claude-4-sonnet',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
    )
  })

  it('keeps the add-model submit disabled while creating and shows an error toast on failure', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: false },
      updateProvider: updateProviderMock
    })
    let rejectCreate!: (error: Error) => void
    createModelMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectCreate = reject
      })
    )

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'alpha-model' }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))
    })

    expect(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /common\.cancel/i })).toBeDisabled()

    await act(async () => {
      rejectCreate(new Error('create failed'))
    })

    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
    expect(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i })).not.toBeDisabled()
  })

  it('ignores a finished add-model submit after the drawer unmounts', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: false },
      updateProvider: updateProviderMock
    })
    const runningCreate = deferred<void>()
    createModelMock.mockReturnValueOnce(runningCreate.promise)
    const onClose = vi.fn()

    const { unmount } = render(<AddModelDrawer providerId="openai" open prefill={null} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'alpha-model' }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))
    })

    unmount()

    await act(async () => {
      runningCreate.resolve(undefined)
      await runningCreate.promise
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', modelId: 'alpha-model' })
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('loads edit values, expands more settings, and keeps save plus auto-save on the existing mutation path', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    expect(screen.getByLabelText('settings.models.add.model_name.label')).toHaveValue('claude-4-sonnet')
    expect(screen.getByTestId('provider-settings-model-edit-drawer-content')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /settings\.moresetting\.label/i }))
    })
    expect(screen.getByTestId('provider-settings-model-more-settings')).toBeInTheDocument()

    await act(async () => {
      const inputPrice = screen.getByLabelText('models.price.input')
      fireEvent.change(inputPrice, {
        target: { value: '12.5' }
      })
      fireEvent.blur(inputPrice)
    })
    expect(updateModelMock).toHaveBeenCalledWith(
      'openai',
      'claude-4-sonnet',
      expect.objectContaining({
        pricing: expect.objectContaining({
          input: expect.objectContaining({ perMillionTokens: 12.5 })
        })
      })
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'settings.models.add.supported_text_delta.label' }))
    })
    expect(updateModelMock).toHaveBeenCalledWith(
      'openai',
      'claude-4-sonnet',
      expect.objectContaining({
        supportsStreaming: false
      })
    )

    await act(async () => {
      fireEvent.change(screen.getByLabelText('settings.models.add.model_name.label'), {
        target: { value: 'Claude 4 Sonnet Updated' }
      })
    })
    const callsBeforeSave = updateModelMock.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /common\.save/i }))
    })

    expect(updateModelMock.mock.calls.length).toBeGreaterThan(callsBeforeSave)
  })

  it('keeps edit-model save disabled while updating and ignores duplicate clicks', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })
    const runningUpdate = deferred<void>()
    updateModelMock.mockReturnValueOnce(runningUpdate.promise)
    const onClose = vi.fn()

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={onClose}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    const saveButton = screen.getByRole('button', { name: /common\.save/i })
    await act(async () => {
      fireEvent.click(saveButton)
      fireEvent.click(saveButton)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(saveButton).toBeDisabled()

    await act(async () => {
      runningUpdate.resolve()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a finished edit-model save after the drawer closes', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })
    const runningUpdate = deferred<void>()
    updateModelMock.mockReturnValueOnce(runningUpdate.promise)
    const onClose = vi.fn()
    const model = {
      id: 'openai::claude-4-sonnet',
      providerId: 'openai',
      name: 'claude-4-sonnet',
      group: 'Anthropic',
      capabilities: [],
      supportsStreaming: true,
      pricing: {
        input: { perMillionTokens: 0, currency: 'USD' },
        output: { perMillionTokens: 0, currency: 'USD' }
      }
    } as any

    const { rerender } = render(<EditModelDrawer providerId="openai" open onClose={onClose} model={model} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /common\.save/i }))
    })

    rerender(<EditModelDrawer providerId="openai" open={false} onClose={onClose} model={model} />)

    await act(async () => {
      runningUpdate.resolve()
      await runningUpdate.promise
    })

    expect(onClose).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()

    rerender(<EditModelDrawer providerId="openai" open onClose={onClose} model={model} />)

    expect(screen.getByRole('button', { name: /common\.save/i })).not.toBeDisabled()
  })

  it('keeps edit-model drawer open and reports save failures', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })
    updateModelMock.mockRejectedValueOnce(new Error('update failed'))
    const onClose = vi.fn()

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={onClose}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /common\.save/i }))
    })

    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('provider-settings-model-edit-drawer-content')).toBeInTheDocument()
  })

  it('writes cherryin endpoint type back through the edit drawer save path', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: true },
      updateProvider: updateProviderMock
    })

    render(
      <EditModelDrawer
        providerId="cherryin"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'cherryin::claude-4-sonnet',
            providerId: 'cherryin',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /common\.save/i }))
    })

    expect(updateModelMock).toHaveBeenCalledWith(
      'cherryin',
      'claude-4-sonnet',
      expect.objectContaining({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      })
    )
  })

  it('shows delete only for disabled models and deletes after confirmation', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })

    const onClose = vi.fn()

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={onClose}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            isEnabled: false,
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.delete/i }))

    expect(window.modal.confirm).toHaveBeenCalledTimes(1)
    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(options.okButtonProps).toEqual({ danger: true })

    await options.onOk()

    expect(deleteModelMock).toHaveBeenCalledWith('openai', 'claude-4-sonnet')
    expect(window.toast.success).toHaveBeenCalledWith('common.delete_success')
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores a finished model delete after the drawer closes', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })
    const runningDelete = deferred<void>()
    deleteModelMock.mockReturnValueOnce(runningDelete.promise)
    const onClose = vi.fn()
    const model = {
      id: 'openai::claude-4-sonnet',
      providerId: 'openai',
      name: 'claude-4-sonnet',
      group: 'Anthropic',
      capabilities: [],
      isEnabled: false,
      supportsStreaming: true,
      pricing: {
        input: { perMillionTokens: 0, currency: 'USD' },
        output: { perMillionTokens: 0, currency: 'USD' }
      }
    } as any

    const { rerender } = render(<EditModelDrawer providerId="openai" open onClose={onClose} model={model} />)

    fireEvent.click(screen.getByRole('button', { name: /common\.delete/i }))

    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const deleteRun = options.onOk()

    rerender(<EditModelDrawer providerId="openai" open={false} onClose={onClose} model={model} />)

    await act(async () => {
      runningDelete.resolve(undefined)
      await deleteRun
    })

    expect(deleteModelMock).toHaveBeenCalledWith('openai', 'claude-4-sonnet')
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prevents duplicate model delete confirmations and operations', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })
    const runningDelete = deferred<void>()
    deleteModelMock.mockReturnValueOnce(runningDelete.promise)
    const onClose = vi.fn()

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={onClose}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            isEnabled: false,
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /common\.delete/i }))

    expect(window.modal.confirm).toHaveBeenCalledTimes(1)
    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]

    const firstDelete = options.onOk()
    const secondDelete = options.onOk()
    expect(deleteModelMock).toHaveBeenCalledTimes(1)

    runningDelete.resolve(undefined)
    await Promise.all([firstDelete, secondDelete])

    expect(window.toast.success).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not show delete action for enabled models', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', isEnabled: true },
      updateProvider: updateProviderMock
    })

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            isEnabled: true,
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    expect(screen.queryByRole('button', { name: /common\.delete/i })).not.toBeInTheDocument()
  })
})
