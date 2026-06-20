export const EXPORT_FETCH_TIMEOUT_MS = 30_000

export function createExportFetchInit(init: RequestInit = {}, timeoutMs = EXPORT_FETCH_TIMEOUT_MS): RequestInit {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  }
}

export function fetchExportResource(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, createExportFetchInit(init))
}
