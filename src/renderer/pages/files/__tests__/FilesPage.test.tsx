import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FilesPage from '../FilesPage'

const mocks = vi.hoisted(() => ({
  openPath: vi.fn()
}))

const testFile = {
  id: 'file-1',
  name: 'note.txt',
  ext: '.txt',
  type: 'document',
  size: 12,
  count: 1,
  created_at: '2026-01-01T00:00:00.000Z'
}

vi.mock('@ant-design/icons', () => ({
  ExclamationCircleOutlined: () => <span data-testid="warning-icon" />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    const { variant, ...buttonProps } = props
    void variant
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  Flex: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  NavbarCenter: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/components/Icons', () => ({
  DeleteIcon: () => <span data-testid="delete-icon" />,
  EditIcon: () => <span data-testid="edit-icon" />
}))

vi.mock('@renderer/components/ListItem', () => ({
  default: ({ title, onClick }: { title: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  )
}))

vi.mock('@renderer/i18n/label', () => ({
  getFileFieldLabelKey: (field: string) => `files.field.${field}`
}))

vi.mock('@renderer/services/FileAction', () => ({
  handleDelete: vi.fn(),
  handleRename: vi.fn(),
  sortFiles: (files: unknown[]) => files,
  tempFilesSort: (files: unknown[]) => files
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    formatFileName: () => testFile.name,
    getFile: vi.fn(),
    getFilePath: () => '/tmp/note.txt'
  }
}))

vi.mock('@renderer/services/StorageV2FileRecoveryService', () => ({
  storageV2FileRecoveryService: {
    listFilesWithFallback: vi.fn()
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      paintings: {}
    })
  }
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: () => '12 B'
}))

vi.mock('antd', () => {
  const Empty = Object.assign(() => <div data-testid="empty" />, {
    PRESENTED_IMAGE_SIMPLE: 'simple'
  })
  return {
    Checkbox: ({
      checked,
      children,
      onChange
    }: React.PropsWithChildren<{
      checked?: boolean
      indeterminate?: boolean
      onChange?: (event: { target: { checked: boolean } }) => void
    }>) => (
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange?.({ target: { checked: event.target.checked } })}
        />
        {children}
      </label>
    ),
    Dropdown: {
      Button: ({ children }: React.PropsWithChildren) => <div>{children}</div>
    },
    Empty,
    Popconfirm: ({ children }: React.PropsWithChildren) => <>{children}</>
  }
})

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => [testFile]
}))

vi.mock('lucide-react', () => ({
  ArrowDownNarrowWide: () => <span data-testid="sort-asc" />,
  ArrowUpWideNarrow: () => <span data-testid="sort-desc" />,
  File: () => <span data-testid="file-icon" />,
  FileImage: () => <span data-testid="image-icon" />,
  FileText: () => <span data-testid="text-icon" />,
  FileType: () => <span data-testid="type-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../FileList', () => ({
  default: ({
    list
  }: {
    list: {
      key: string
      file: React.ReactNode
    }[]
  }) => (
    <div>
      {list.map((item) => (
        <div key={item.key}>{item.file}</div>
      ))}
    </div>
  )
}))

describe('FilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          openPath: mocks.openPath
        }
      }
    })
  })

  it('does not crash when opening a file fails before toast is available', async () => {
    mocks.openPath.mockRejectedValue(new Error('open failed'))
    render(<FilesPage />)

    fireEvent.click(screen.getByText('note.txt'))

    await waitFor(() => {
      expect(mocks.openPath).toHaveBeenCalledWith('/tmp/note.txt')
    })
  })
})
