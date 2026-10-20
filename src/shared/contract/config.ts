import { call, defineDomain, str } from './define'

/** 主进程 config.json 中的配置。 */
export const config = defineDomain('config', {
  /** 设置下载目录（主进程会实测可写） */
  setDownloadPath: call<[path: string], void>(a => [str(a[0], 'path')]),
})
