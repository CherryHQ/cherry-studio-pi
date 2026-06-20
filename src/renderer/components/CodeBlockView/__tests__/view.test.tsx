import '@testing-library/jest-dom/vitest'

import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeBlockView } from '../view'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  clipboard: {
    writeText: vi.fn()
  },
  copyToolProps: undefined as any,
  downloadToolProps: undefined as any,
  pyodideRunScript: vi.fn(),
  runToolProps: undefined as any,
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  CodeEditor: () => <pre data-testid="code-editor" />
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [
    {
      autocompletion: false,
      enabled: false,
      foldGutter: false,
      highlightActiveLine: false,
      keymap: 'default',
      themeDark: 'dark',
      themeLight: 'light'
    }
  ],
  usePreference: (key: string) => {
    const preferences: Record<string, unknown> = {
      'chat.code.collapsible': false,
      'chat.code.editor.enabled': false,
      'chat.code.execution.enabled': true,
      'chat.code.execution.timeout_minutes': 2,
      'chat.code.image_tools': false,
      'chat.code.show_line_numbers': false,
      'chat.code.wrappable': false,
      'chat.message.font_size': 14
    }

    return [preferences[key]]
  }
}))

vi.mock('@iconify/react', () => ({
  Icon: () => <span data-testid="file-icon" />
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/CodeToolbar', () => ({
  CodeToolbar: () => <div data-testid="code-toolbar" />,
  useCopyTool: vi.fn((props) => {
    mocks.copyToolProps = props
  }),
  useDownloadTool: vi.fn((props) => {
    mocks.downloadToolProps = props
  }),
  useExpandTool: vi.fn(),
  useRunTool: vi.fn((props) => {
    mocks.runToolProps = props
  }),
  useSaveTool: vi.fn(),
  useSplitViewTool: vi.fn(),
  useViewSourceTool: vi.fn(),
  useWrapTool: vi.fn()
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre data-testid="code-viewer">{value}</pre>
}))

vi.mock('@renderer/components/ImageViewer', () => ({
  default: () => <img alt="result" />
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@renderer/services/PyodideService', () => ({
  pyodideService: {
    runScript: mocks.pyodideRunScript
  }
}))

vi.mock('@renderer/utils/codeLanguage', () => ({
  getExtensionByLanguage: () => '.py'
}))

vi.mock('@renderer/utils/fileIconName', () => ({
  getFileIconName: () => 'python'
}))

vi.mock('@renderer/utils/formats', () => ({
  extractHtmlTitle: vi.fn(),
  getFileNameFromHtmlTitle: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../constants', () => ({
  SPECIAL_VIEW_COMPONENTS: {},
  SPECIAL_VIEWS: []
}))

vi.mock('../StatusBar', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="status-bar">{children}</div>
}))

describe('CodeBlockView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.copyToolProps = undefined
    mocks.downloadToolProps = undefined
    mocks.runToolProps = undefined

    Object.assign(navigator, { clipboard: mocks.clipboard })
    Object.assign(window, {
      api: {
        file: {
          save: vi.fn().mockResolvedValue(undefined)
        }
      },
      toast: mocks.toast
    })
  })

  it('ignores delayed source copy feedback after unmount', async () => {
    const runningCopy = deferred<void>()
    mocks.clipboard.writeText.mockReturnValueOnce(runningCopy.promise)
    const { unmount } = render(<CodeBlockView language="python">print("hi")</CodeBlockView>)

    const copyPromise = mocks.copyToolProps.onCopySource()
    expect(mocks.clipboard.writeText).toHaveBeenCalledWith('print("hi")')
    unmount()

    await act(async () => {
      runningCopy.resolve()
      await copyPromise
    })

    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('ignores delayed script results after unmount', async () => {
    const runningScript = deferred<{ text: string }>()
    mocks.pyodideRunScript.mockReturnValueOnce(runningScript.promise)
    const { unmount } = render(<CodeBlockView language="python">print("hi")</CodeBlockView>)

    act(() => {
      mocks.runToolProps.onRun()
    })
    expect(mocks.pyodideRunScript).toHaveBeenCalledWith('print("hi")', {}, 120000)
    unmount()

    await act(async () => {
      runningScript.resolve({ text: 'done' })
      await runningScript.promise
    })

    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})
