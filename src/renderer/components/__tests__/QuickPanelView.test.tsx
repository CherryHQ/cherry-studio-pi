import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuickPanelListItem } from '../QuickPanel'
import { QuickPanelProvider, QuickPanelView, useQuickPanel } from '../QuickPanel'

// Mock the DynamicVirtualList component
vi.mock('@renderer/components/VirtualList', async (importOriginal) => {
  // oxlint-disable-next-line consistent-type-imports
  const mod = await importOriginal<typeof import('@renderer/components/VirtualList')>()
  return {
    ...mod,
    DynamicVirtualList: ({ ref, list, children, scrollerStyle }: any & { ref?: React.RefObject<any | null> }) => {
      // Expose a mock function for scrollToIndex
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: vi.fn()
      }))

      // Render all items, not virtualized
      return (
        <div style={scrollerStyle}>
          {list.map((item: any, index: number) => (
            <div key={item.id || index}>{children(item, index)}</div>
          ))}
        </div>
      )
    }
  }
})

function createList(length: number, prefix = 'Item', extra: Partial<QuickPanelListItem> = {}) {
  return Array.from({ length }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    label: `${prefix} ${i + 1}`,
    description: `${prefix} Description ${i + 1}`,
    icon: `${prefix} Icon ${i + 1}`,
    action: () => {},
    ...extra
  }))
}

type KeyStep = {
  key: string
  ctrlKey?: boolean
  expected: string | ((text: string) => boolean)
}

const PAGE_SIZE = 7

// 用于测试 open 行为的组件
function OpenPanelOnMount({ list, onClose }: { list: QuickPanelListItem[]; onClose?: ReturnType<typeof vi.fn> }) {
  const quickPanel = useQuickPanel()
  useEffect(() => {
    quickPanel.open({
      title: 'Test Panel',
      list,
      symbol: 'test',
      pageSize: PAGE_SIZE,
      onClose
    })
  }, [list, onClose, quickPanel])
  return null
}

function OpenPanelOnceOnMount({ list }: { list: QuickPanelListItem[] }) {
  const quickPanel = useQuickPanel()
  const didOpenRef = React.useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true
    quickPanel.open({
      title: 'Test Panel',
      list,
      symbol: 'test',
      pageSize: PAGE_SIZE
    })
  }, [list, quickPanel])

  return null
}

function OpenAndClosePanelOnMount({ onClose }: { onClose: ReturnType<typeof vi.fn> }) {
  const quickPanel = useQuickPanel()
  const didOpenRef = React.useRef(false)
  const didCloseRef = React.useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true
    quickPanel.open({
      list: [],
      onClose,
      symbol: 'test'
    })
  }, [onClose, quickPanel])

  useEffect(() => {
    if (!quickPanel.onClose || didCloseRef.current) return
    didCloseRef.current = true
    quickPanel.close('esc', 'query')
  }, [quickPanel])

  return null
}

function wrapWithProviders(children: React.ReactNode) {
  return <QuickPanelProvider>{children}</QuickPanelProvider>
}

describe('QuickPanelView', () => {
  beforeEach(() => {
    // 添加一个假的 .inputbar textarea 到 document.body
    const inputbar = document.createElement('div')
    inputbar.className = 'inputbar'
    const textarea = document.createElement('textarea')
    inputbar.appendChild(textarea)
    document.body.appendChild(inputbar)
  })

  afterEach(() => {
    const inputbar = document.querySelector('.inputbar')
    if (inputbar) inputbar.remove()
  })

  describe('rendering', () => {
    it('should render without crashing when wrapped in QuickPanelProvider', () => {
      render(wrapWithProviders(<QuickPanelView setInputText={vi.fn()} />))

      // 检查面板容器是否存在且初始不可见
      const panel = screen.getByTestId('quick-panel')
      expect(panel.classList.contains('visible')).toBe(false)
    })

    it('should render list after open', async () => {
      const list = createList(100)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      // 检查面板可见
      const panel = screen.getByTestId('quick-panel')
      expect(panel.classList.contains('visible')).toBe(true)
      // 检查第一个 item 是否渲染
      expect(screen.getByText('Item 1')).toBeInTheDocument()
    })

    it('passes the quick panel context to onClose callbacks', async () => {
      const onClose = vi.fn()

      render(wrapWithProviders(<OpenAndClosePanelOnMount onClose={onClose} />))

      await waitFor(() =>
        expect(onClose).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'esc',
            context: expect.objectContaining({
              close: expect.any(Function),
              open: expect.any(Function),
              updateItemSelection: expect.any(Function)
            }),
            searchText: 'query'
          })
        )
      )
    })
  })

  describe('focusing', () => {
    // 执行一系列按键，检查 focused item 是否正确
    async function runKeySequenceAndCheck(panel: HTMLElement, sequence: KeyStep[]) {
      const user = userEvent.setup()
      for (const { key, ctrlKey, expected } of sequence) {
        let keyString = ''
        if (ctrlKey) keyString += '{Control>}'
        keyString += key.length === 1 ? key : `{${key}}`
        if (ctrlKey) keyString += '{/Control}'
        await user.keyboard(keyString)

        // 检查是否只有一个 focused item
        const focused = panel.querySelectorAll('.focused')
        expect(focused.length).toBe(1)
        // 检查 focused item 是否包含预期文本
        const text = focused[0].textContent || ''
        if (typeof expected === 'string') {
          expect(text).toContain(expected)
        } else {
          expect(expected(text)).toBe(true)
        }
      }
    }

    it('should not focus on any item after panel open by default', () => {
      const list = createList(100)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      // 检查是否没有任何 focused item
      const panel = screen.getByTestId('quick-panel')
      const focused = panel.querySelectorAll('.focused')
      expect(focused.length).toBe(0)

      // 检查第一个 item 存在但没有 focused 类
      const item1 = screen.getByText('Item 1')
      expect(item1).toBeInTheDocument()
      const focusedItem1 = item1.closest('.focused')
      expect(focusedItem1).toBeNull()
    })

    it('should focus on the right item using ArrowUp, ArrowDown', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'ArrowDown', expected: 'Item 1' }, // 从未选中状态按 ArrowDown 会选中第一个
        { key: 'ArrowUp', expected: 'Item 100' }, // 从第一个按 ArrowUp 会循环到最后一个
        { key: 'ArrowUp', expected: 'Item 99' },
        { key: 'ArrowDown', expected: 'Item 100' },
        { key: 'ArrowDown', expected: 'Item 1' } // 从最后一个按 ArrowDown 会循环到第一个
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('should focus on the right item using PageUp, PageDown', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'PageDown', expected: `Item ${PAGE_SIZE}` }, // 从未选中状态按 PageDown 会选中第 pageSize 个项目
        { key: 'PageUp', expected: 'Item 1' }, // PageUp 会选中第一个
        { key: 'ArrowUp', expected: 'Item 100' }, // 从第一个按 ArrowUp 会到最后一个
        { key: 'PageDown', expected: 'Item 100' }, // 从最后一个按 PageDown 仍然是最后一个
        { key: 'PageUp', expected: `Item ${100 - PAGE_SIZE}` } // PageUp 会向上翻页，从索引99到92，对应Item 93
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('should focus on the right item using Ctrl+ArrowUp, Ctrl+ArrowDown', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'ArrowDown', ctrlKey: true, expected: 'Item 1' }, // 从未选中状态按 Ctrl+ArrowDown 会选中第一个
        { key: 'ArrowDown', ctrlKey: true, expected: `Item ${PAGE_SIZE + 1}` }, // Ctrl+ArrowDown 会跳转 pageSize 个位置
        { key: 'ArrowUp', ctrlKey: true, expected: 'Item 1' }, // Ctrl+ArrowUp 会跳转回去
        { key: 'ArrowUp', ctrlKey: true, expected: 'Item 100' }, // 从第一个位置再按 Ctrl+ArrowUp 会循环到最后
        { key: 'ArrowDown', ctrlKey: true, expected: 'Item 1' } // 从最后位置按 Ctrl+ArrowDown 会循环到第一个
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('uses the modifier state from the current keydown event for page jumps', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')
      fireEvent.keyDown(window, { key: 'ArrowDown' })
      await waitFor(() => expect(panel.querySelector('.focused')?.textContent).toContain('Item 1'))

      fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true })
      await waitFor(() => expect(panel.querySelector('.focused')?.textContent).toContain(`Item ${PAGE_SIZE + 1}`))
    })

    it('prevents Enter from leaking to the input when an empty visible panel closes', async () => {
      const onClose = vi.fn()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={[]} onClose={onClose} />
          </>
        )
      )

      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      })
      const stopPropagation = vi.spyOn(enterEvent, 'stopPropagation')
      fireEvent(window, enterEvent)

      expect(enterEvent.defaultPrevented).toBe(true)
      expect(stopPropagation).toHaveBeenCalled()
      await waitFor(() =>
        expect(onClose).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'enter_empty'
          })
        )
      )
    })

    it('ignores click events whose target is not an element', () => {
      const onClose = vi.fn()
      const list = createList(1)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} onClose={onClose} />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')
      expect(panel).toHaveClass('visible')

      expect(() => {
        window.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true
          })
        )
      }).not.toThrow()

      expect(panel).toHaveClass('visible')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should return to the previous menu with Ctrl+ArrowLeft without mutating history state', async () => {
      const user = userEvent.setup()
      const childList = createList(1, 'Child')
      const rootList: QuickPanelListItem[] = [
        {
          label: 'Open child menu',
          icon: '',
          isMenu: true,
          action: ({ context }) => {
            context.open({
              title: 'Child Panel',
              list: childList,
              symbol: 'child',
              pageSize: PAGE_SIZE
            })
          }
        }
      ]

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnceOnMount list={rootList} />
          </>
        )
      )

      fireEvent.mouseMove(screen.getByTestId('quick-panel').firstElementChild!)
      const rootMenuItem = screen.getByText('Open child menu').closest('[data-id]')
      expect(rootMenuItem).not.toBeNull()
      await user.click(rootMenuItem!)
      await waitFor(() => expect(screen.getByText('Child 1')).toBeInTheDocument())
      expect(screen.queryByText('Open child menu')).not.toBeInTheDocument()

      await user.keyboard('{Control>}{ArrowLeft}{/Control}')

      await waitFor(() => expect(screen.getByText('Open child menu')).toBeInTheDocument())
      expect(screen.queryByText('Child 1')).not.toBeInTheDocument()
    })
  })
})
