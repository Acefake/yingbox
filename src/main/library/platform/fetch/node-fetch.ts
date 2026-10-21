/**
 * Node 端默认出网实现：Node 自带的 fetch（undici）。
 *
 * 与 Electron net.fetch 的差别：没有 Chromium 的 TLS 指纹，也不读系统代理。
 * 需要代理时用标准环境变量（HTTPS_PROXY / HTTP_PROXY / NO_PROXY）并设 NODE_USE_ENV_PROXY=1
 * （Node 22.21+ / 24 支持，进程启动时读取）。被 Cloudflare 拦下时由番号源的按主机熔断跳过，
 * 需要浏览器指纹的站点换 curl-impersonate（见 curl-fetch.ts）。
 */
import type { HttpFetch } from '../../identify/identify-module'

/** 创建基于全局 fetch 的出网实现。 */
export function createNodeFetch(
  fetchImpl: typeof fetch = globalThis.fetch
): HttpFetch {
  return ((url, init) =>
    fetchImpl(url, {
      headers: init.headers,
      signal: init.signal,
      redirect: 'follow',
    })) as HttpFetch
}
