// import { useAppDispatch, useAppSelector } from '@renderer/store'
// import { setUserTheme, UserTheme } from '@renderer/store/settings'

import { usePreference } from '@data/hooks/usePreference'
import Color from 'color'

type UserTheme = {
  colorPrimary: string
  userFontFamily: string
  userCodeFontFamily: string
}

export default function useUserTheme() {
  const [colorPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')
  const [userFontFamily, setUserFontFamily] = usePreference('ui.theme_user.font_family')
  const [userCodeFontFamily, setUserCodeFontFamily] = usePreference('ui.theme_user.code_font_family')

  const setOptionalCssVar = (name: string, value?: string) => {
    if (value?.trim()) {
      document.documentElement.style.setProperty(name, `'${value}'`)
      return
    }

    document.documentElement.style.removeProperty(name)
  }

  const initUserTheme = (theme: Partial<UserTheme> = {}) => {
    const nextColorPrimary = Color(theme.colorPrimary ?? colorPrimary)

    document.documentElement.style.setProperty('--cs-theme-primary', nextColorPrimary.toString())
    setOptionalCssVar('--cs-user-font-family', theme.userFontFamily ?? userFontFamily)
    setOptionalCssVar('--cs-user-code-font-family', theme.userCodeFontFamily ?? userCodeFontFamily)
  }

  const currentUserTheme = { colorPrimary, userFontFamily, userCodeFontFamily }

  return {
    colorPrimary: Color(colorPrimary),

    initUserTheme,

    userTheme: currentUserTheme,

    async setUserTheme(userTheme: UserTheme) {
      initUserTheme(userTheme)
      try {
        await Promise.all([
          setColorPrimary(userTheme.colorPrimary),
          setUserFontFamily(userTheme.userFontFamily),
          setUserCodeFontFamily(userTheme.userCodeFontFamily)
        ])
      } catch (error) {
        initUserTheme(currentUserTheme)
        throw error
      }
    }
  }
}
