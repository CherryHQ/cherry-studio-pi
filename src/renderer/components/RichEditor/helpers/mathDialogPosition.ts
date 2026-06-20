export interface MathDialogPosition {
  x: number
  y: number
  top: number
}

interface MathDialogPositionEditor {
  view: {
    nodeDOM: (pos: number) => globalThis.Node | null
  }
}

function getElementFromNode(dom: globalThis.Node | null): Element | null {
  if (typeof Element !== 'undefined' && dom instanceof Element) return dom
  if (typeof Node !== 'undefined' && dom instanceof Node) return dom.parentElement
  return null
}

export function getMathDialogPosition(
  editor: MathDialogPositionEditor | null | undefined,
  pos: number
): MathDialogPosition | undefined {
  const element = getElementFromNode(editor?.view.nodeDOM(pos) ?? null)
  const mathElement = element?.closest(
    '[data-type="block-math"], [data-type="inline-math"], .tiptap-mathematics-render'
  )
  const target = mathElement ?? element
  if (!target) return undefined

  const rect = target.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom,
    top: rect.top
  }
}
