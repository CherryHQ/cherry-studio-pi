import { describe, expect, it } from 'vitest'

import { quoteDesktopExecArg } from '../desktopEntry'

describe('desktopEntry', () => {
  it('quotes Exec arguments with freedesktop double-quote escaping', () => {
    expect(quoteDesktopExecArg('/home/cherry/Apps/Cherry Studio Pi.AppImage')).toBe(
      '"/home/cherry/Apps/Cherry Studio Pi.AppImage"'
    )
    expect(quoteDesktopExecArg('/home/cherry/Apps/Cherry "Pi" $Nightly.AppImage')).toBe(
      '"/home/cherry/Apps/Cherry \\"Pi\\" \\$Nightly.AppImage"'
    )
  })
})
