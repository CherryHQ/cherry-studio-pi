import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDeepLinkImport } from '../useProviderDeepLinkImport'

const createProviderMock = vi.fn()
const updateProviderByIdMock = vi.fn()
const addApiKeyTriggerMock = vi.fn()
const navigateMock = vi.fn()
const popupShowMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    createProvider: createProviderMock
  }),
  useProviderActions: () => ({
    updateProviderById: updateProviderByIdMock
  })
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({
    trigger: addApiKeyTriggerMock
  })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('../../UrlSchemaInfoPopup', () => ({
  default: {
    show: (...args: any[]) => popupShowMock(...args)
  }
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('useProviderDeepLinkImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createProviderMock.mockResolvedValue({ id: 'openai' })
    updateProviderByIdMock.mockResolvedValue(undefined)
    addApiKeyTriggerMock.mockResolvedValue(undefined)
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
  })

  it('creates a provider, posts the API key, and navigates for a valid deep link', async () => {
    const onSelectProvider = vi.fn()

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com'
      },
      isNew: true,
      displayName: 'OpenAI'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com',
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(createProviderMock).toHaveBeenCalledTimes(1))

    expect(popupShowMock).toHaveBeenCalledWith({
      id: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com',
      type: 'openai',
      name: 'OpenAI'
    })
    expect(createProviderMock).toHaveBeenCalledWith({
      providerId: 'openai',
      name: 'OpenAI',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.openai.com'
        }
      }
    })
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).toHaveBeenCalledWith({
      params: { providerId: 'openai' },
      body: { key: 'sk-openai' }
    })
    expect(onSelectProvider).toHaveBeenCalledWith('openai')
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/provider',
      search: { id: 'openai' }
    })
    expect(window.toast.success).toHaveBeenCalledTimes(1)
  })

  it('updates an existing provider when the deep link resolves to an existing entry', async () => {
    const onSelectProvider = vi.fn()

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        apiKey: 'sk-anthropic',
        apiHost: 'https://api.anthropic.com'
      },
      isNew: false,
      displayName: 'Anthropic'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'anthropic',
          apiKey: 'sk-anthropic',
          baseUrl: 'https://api.anthropic.com',
          type: 'anthropic',
          name: 'Anthropic'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(updateProviderByIdMock).toHaveBeenCalledTimes(1))

    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).toHaveBeenCalledWith('anthropic', {
      name: 'Anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://api.anthropic.com'
        }
      }
    })
    expect(addApiKeyTriggerMock).toHaveBeenCalledWith({
      params: { providerId: 'anthropic' },
      body: { key: 'sk-anthropic' }
    })
    expect(onSelectProvider).toHaveBeenCalledWith('anthropic')
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/provider',
      search: { id: 'anthropic' }
    })
  })

  it('shows an error toast and clears the search state for invalid input', async () => {
    const onSelectProvider = vi.fn()

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: '',
          apiKey: 'sk-invalid',
          baseUrl: ''
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledTimes(1))

    expect(popupShowMock).not.toHaveBeenCalled()
    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' })
    expect(onSelectProvider).not.toHaveBeenCalled()
  })

  it('rejects non-string provider import fields before showing the popup', async () => {
    const onSelectProvider = vi.fn()

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 123,
          apiKey: ['sk-invalid'],
          baseUrl: { value: 'https://api.openai.com' },
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledTimes(1))

    expect(popupShowMock).not.toHaveBeenCalled()
    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' })
    expect(onSelectProvider).not.toHaveBeenCalled()
  })

  it('trims provider import string fields before showing the popup', async () => {
    const onSelectProvider = vi.fn()

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com'
      },
      isNew: true,
      displayName: 'OpenAI'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: ' openai ',
          apiKey: ' sk-openai ',
          baseUrl: ' https://api.openai.com ',
          type: 'openai',
          name: ' OpenAI '
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(popupShowMock).toHaveBeenCalledTimes(1))

    expect(popupShowMock).toHaveBeenCalledWith({
      id: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com',
      type: 'openai',
      name: 'OpenAI'
    })
  })

  it('shows an error toast and clears the search state when provider import mutations fail', async () => {
    const onSelectProvider = vi.fn()
    createProviderMock.mockRejectedValue(new Error('create failed'))
    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com'
      },
      isNew: true,
      displayName: 'OpenAI'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com',
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledTimes(1))

    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(onSelectProvider).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' })
  })

  it('does not continue a pending popup import after unmount', async () => {
    const onSelectProvider = vi.fn()
    const popup = createDeferred<any>()
    popupShowMock.mockReturnValue(popup.promise)

    const { unmount } = renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com',
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(popupShowMock).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      popup.resolve({
        updatedProvider: {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'sk-openai',
          apiHost: 'https://api.openai.com'
        },
        isNew: true,
        displayName: 'OpenAI'
      })
      await popup.promise
    })

    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(onSelectProvider).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('does not show stale import errors after unmount', async () => {
    const onSelectProvider = vi.fn()
    const createProvider = createDeferred<any>()
    createProviderMock.mockReturnValueOnce(createProvider.promise)
    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com'
      },
      isNew: true,
      displayName: 'OpenAI'
    })

    const { unmount } = renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com',
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(createProviderMock).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      createProvider.reject(new Error('closed'))
      await createProvider.promise.catch(() => undefined)
    })

    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(onSelectProvider).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
