/**
 * 播放代理（yingbox-stream://）与直播线路探测共用的出网客户端：Chromium 网络栈（不带 Cookie）
 * + 系统 DNS 解析，SSRF 校验与逐跳重定向由 shared/net/client 负责。
 * 逐跳重定向要拿到 3xx 原响应，net.fetch 做不到，经 manualRedirectFetch 改走 net.request。
 */
import { lookup } from 'node:dns/promises'
import { net } from 'electron'

import { type NetClient, createNetClient } from '../shared/net/client'
import { manualRedirectFetch } from '../shared/net/manual-redirect-fetch'

let client: NetClient | null = null

/** 进程内唯一的流媒体出网客户端（首次调用时创建） */
export function streamNetClient(): NetClient {
  client ??= createNetClient({
    fetch: manualRedirectFetch(
      options => net.request(options),
      (url, init) => net.fetch(url, { ...init, credentials: 'omit' })
    ),
    lookup: host => lookup(host, { all: true }),
  })
  return client
}
