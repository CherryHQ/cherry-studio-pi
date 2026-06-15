import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { buildAboutReleaseNotesUrl } from '../aboutReleaseNotesUrl'

describe('buildAboutReleaseNotesUrl', () => {
  it('encodes app paths with spaces when building the packaged release notes URL', () => {
    expect(
      buildAboutReleaseNotesUrl('/Applications/Cherry Studio Pi.app/Contents/Resources/app.asar', ThemeMode.dark)
    ).toBe(
      'file:///Applications/Cherry%20Studio%20Pi.app/Contents/Resources/app.asar/resources/cherry-studio/releases.html?theme=dark'
    )
  })

  it('encodes Windows app paths and uses light theme outside dark mode', () => {
    expect(buildAboutReleaseNotesUrl('C:\\Program Files\\Cherry Studio Pi\\resources\\app.asar', ThemeMode.light)).toBe(
      'file:///C:/Program%20Files/Cherry%20Studio%20Pi/resources/app.asar/resources/cherry-studio/releases.html?theme=light'
    )
  })
})
