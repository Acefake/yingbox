export interface AmaneSettings {
  mode: 'managed' | 'external'
  executablePath: string
  baseUrl: string
  dataDirectory: string
  tokenConfigured: boolean
  /** 开发模式:由影盒运行项目内 Amane 源码(而非打包后台)。 */
  devSource?: boolean
}

export interface AmaneStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  owned: boolean
  version?: string
  error?: string
  settings: AmaneSettings
}

export interface AmaneRequest {
  path: string
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}
