import { reduxService } from '@main/services/ReduxService'

type ApiServerRuntimeConfig = {
  host: string
  port: number
  apiKey?: string
}

export const config = {
  async get(): Promise<ApiServerRuntimeConfig | null> {
    const apiServer = await reduxService.select<any>('state.settings.apiServer').catch(() => null)
    if (!apiServer?.enabled || !apiServer?.port) {
      return null
    }

    return {
      host: apiServer.host || '127.0.0.1',
      port: Number(apiServer.port),
      apiKey: typeof apiServer.apiKey === 'string' ? apiServer.apiKey : undefined
    }
  }
}
