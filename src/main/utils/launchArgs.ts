const NEW_DATA_PATH_ARG_PREFIX = '--new-data-path='

export function getNewDataPathFromArgs(argv: readonly string[] = process.argv): string | undefined {
  const arg = argv.slice(1).find((value) => value.startsWith(NEW_DATA_PATH_ARG_PREFIX))
  if (!arg) return undefined

  const value = arg.slice(NEW_DATA_PATH_ARG_PREFIX.length)
  return value.length > 0 ? value : undefined
}
