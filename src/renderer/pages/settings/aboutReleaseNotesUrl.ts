import { pathToFileUrl } from '@renderer/utils/fileUrl'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

export function buildAboutReleaseNotesUrl(appPath: string, theme: ThemeMode): string {
  const url = new URL(pathToFileUrl(`${appPath}/resources/cherry-studio/releases.html`))
  url.searchParams.set('theme', theme === ThemeMode.dark ? 'dark' : 'light')
  return url.toString()
}
