export const removeDraggableFromDragHandleTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (!target.classList.contains('drag-handle')) return false

  target.removeAttribute('draggable')
  return true
}
