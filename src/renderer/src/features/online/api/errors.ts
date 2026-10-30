/** 连接后台失败，不代表远程数据源本身失效。 */
export class OnlineTransportError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : '后台连接失败')
    this.name = 'OnlineTransportError'
  }
}
