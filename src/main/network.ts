/** 公网请求与诊断组装；每个重定向目标均由共享网络客户端校验。 */
import { lookup } from 'node:dns/promises'
import { type FetchImpl, createNetClient } from '../shared/net/client'
import { type NetworkProbeResult, probeNetwork } from '../shared/network/probe'
import type { NetworkPreferences } from '../shared/network/preferences'

const publicClient = createNetClient({
  fetch: (url, init) => fetch(url, init),
  lookup: hostname => lookup(hostname, { all: true }),
})

const client = createNetClient({
  fetch: (url, init) => fetch(url, init),
  lookup: hostname => lookup(hostname, { all: true }),
  network: () => ({ githubMode: 'direct', mirrors: [], tmdbMode: 'direct' }),
})

/** 使用明确公开样本探测；TMDB 两个端点分别测，不在诊断中自动回退。 */
export function testNetwork(
  preferences: NetworkPreferences,
  send?: FetchImpl
): Promise<NetworkProbeResult[]> {
  const probe = send
    ? createNetClient({
        fetch: send,
        lookup: hostname => lookup(hostname, { all: true }),
        network: () => ({
          githubMode: 'direct',
          mirrors: [],
          tmdbMode: 'direct',
        }),
      })
    : client
  return probeNetwork(probe, preferences)
}

/** 无凭据公网 GET，适用于公开更新元数据和附件。 */
export async function publicFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const headers: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value
  })
  return (
    await publicClient.open(url, {
      headers,
      signal: init?.signal ?? undefined,
      timeoutMs: 0,
    })
  ).response
}
