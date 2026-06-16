export interface BooleanRef {
  current: boolean
}

export async function runExclusiveOperation<T>(
  operationRef: BooleanRef,
  operation: () => Promise<T>
): Promise<T | undefined> {
  if (operationRef.current) {
    return undefined
  }

  operationRef.current = true
  try {
    return await operation()
  } finally {
    operationRef.current = false
  }
}
