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

export interface AmaneBridge {
  status(): Promise<AmaneStatus>
  start(): Promise<AmaneStatus>
  stop(): Promise<AmaneStatus>
  configure(
    settings: Partial<Omit<AmaneSettings, 'tokenConfigured'>> & {
      token?: string
    }
  ): Promise<AmaneStatus>
  selectExecutable(): Promise<string | null>
  request<T = unknown>(request: AmaneRequest): Promise<T>
  /**
   * 解析媒体 ID 对应的本地文件路径。
   * 只返回路径，由渲染层交给统一播放器，从而遵循“播放器引擎”设置。
   */
  resolveMedia(
    mediaId: number
  ): Promise<{ success: boolean; filePath?: string; error?: string }>
  /** 手机接入信息:当前服务的 baseUrl 与 API token。 */
  connection(): Promise<{ baseUrl: string; token: string }>
}
