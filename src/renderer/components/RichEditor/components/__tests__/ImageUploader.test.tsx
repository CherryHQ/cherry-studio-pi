import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageUploader } from '../ImageUploader'

const mocks = vi.hoisted(() => ({
  dropFile: undefined as File | undefined,
  loggerError: vi.fn(),
  t: (key: string) => key
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>

  return {
    Button: ({ children, disabled, onClick, ...props }: any) => (
      <button type="button" disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    Dropzone: ({ children, disabled, onDrop, onError }: any) => (
      <button
        type="button"
        aria-label="dropzone"
        disabled={disabled}
        onClick={() => {
          if (mocks.dropFile) {
            onDrop([mocks.dropFile])
          } else {
            onError?.(new Error('no file'))
          }
        }}>
        {children}
      </button>
    ),
    Input: ({ value, onChange, onKeyDown, placeholder, className }: any) => (
      <input value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} className={className} />
    ),
    Tabs: Passthrough,
    TabsContent: Passthrough,
    TabsList: Passthrough,
    TabsTrigger: Passthrough
  }
})

class MockFileReader {
  static instances: MockFileReader[] = []

  result: string | ArrayBuffer | null = 'data:image/png;base64,ok'
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null

  constructor() {
    MockFileReader.instances.push(this)
  }

  readAsDataURL = vi.fn()

  triggerLoad() {
    this.onload?.({} as ProgressEvent<FileReader>)
  }
}

describe('ImageUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockFileReader.instances = []
    mocks.dropFile = new File(['image'], 'image.png', { type: 'image/png' })
    vi.stubGlobal('FileReader', MockFileReader)
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('inserts and closes when an uploaded image is still active', async () => {
    const onImageSelect = vi.fn()
    const onClose = vi.fn()

    render(<ImageUploader visible onImageSelect={onImageSelect} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'dropzone' }))
    expect(MockFileReader.instances).toHaveLength(1)

    await act(async () => {
      MockFileReader.instances[0].triggerLoad()
    })

    expect(onImageSelect).toHaveBeenCalledWith('data:image/png;base64,ok')
    expect(window.toast.success).toHaveBeenCalledWith('richEditor.imageUploader.uploadSuccess')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores file reads that finish after the uploader closes', async () => {
    const onImageSelect = vi.fn()
    const onClose = vi.fn()

    const { rerender } = render(<ImageUploader visible onImageSelect={onImageSelect} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'dropzone' }))
    expect(MockFileReader.instances).toHaveLength(1)

    rerender(<ImageUploader visible={false} onImageSelect={onImageSelect} onClose={onClose} />)

    await act(async () => {
      MockFileReader.instances[0].triggerLoad()
    })

    expect(onImageSelect).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
