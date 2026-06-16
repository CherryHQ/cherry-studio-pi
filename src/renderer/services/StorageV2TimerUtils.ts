export function unrefTimer(timer: ReturnType<typeof setTimeout> | null | undefined) {
  if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref()
  }
}
