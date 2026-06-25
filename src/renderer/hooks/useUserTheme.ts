import { usePreference } from '@data/hooks/usePreference'
import Color from 'color'
import { useCallback, useMemo } from 'react'

type UserTheme = {
  colorPrimary: string
  userFontFamily: string
  userCodeFontFamily: string
}

const setOptionalCssVar = (name: string, value?: string) => {
  if (value?.trim()) {
    document.documentElement.style.setProperty(name, `'${value}'`)
    return
  }

  document.documentElement.style.removeProperty(name)
}

export default function useUserTheme() {
  const [colorPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')
  const [userFontFamily, setUserFontFamily] = usePreference('ui.theme_user.font_family')
  const [userCodeFontFamily, setUserCodeFontFamily] = usePreference('ui.theme_user.code_font_family')

  const initUserTheme = useCallback(
    (theme: Partial<UserTheme> = {}) => {
      const nextColorPrimary = Color(theme.colorPrimary ?? colorPrimary)

      document.documentElement.style.setProperty('--cs-theme-primary', nextColorPrimary.toString())
      setOptionalCssVar('--cs-user-font-family', theme.userFontFamily ?? userFontFamily)
      setOptionalCssVar('--cs-user-code-font-family', theme.userCodeFontFamily ?? userCodeFontFamily)
    },
    [colorPrimary, userCodeFontFamily, userFontFamily]
  )

  const currentUserTheme = useMemo(
    () => ({ colorPrimary, userFontFamily, userCodeFontFamily }),
    [colorPrimary, userCodeFontFamily, userFontFamily]
  )

  const setUserTheme = useCallback(
    async (userTheme: UserTheme) => {
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
    },
    [currentUserTheme, initUserTheme, setColorPrimary, setUserCodeFontFamily, setUserFontFamily]
  )

  const parsedColorPrimary = useMemo(() => Color(colorPrimary), [colorPrimary])

  return {
    colorPrimary: parsedColorPrimary,

    initUserTheme,

    userTheme: currentUserTheme,

    setUserTheme
  }
}
