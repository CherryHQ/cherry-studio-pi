import { getBinaryName } from './binaryResolver'
import { autoDiscoverGitBash, findExecutableInEnv } from './commandResolver'
import { crossPlatformSpawn, runInstallScript } from './processRunner'

export { crossPlatformSpawn, findExecutableInEnv, getBinaryName, runInstallScript }

export function getGitBashPathInfo(): { path: string | null } {
  return { path: autoDiscoverGitBash() }
}
