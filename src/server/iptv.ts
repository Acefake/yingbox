import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import { createEpgStore } from '../main/iptv/epg-store'
import { PLAYLIST_MAX_BYTES } from '../main/iptv/playlist-io'
import { probeStream } from '../main/iptv/stream-probe'
import { decodeSubtitleText } from '../main/subtitle'
import { iptv } from '../shared/contract/iptv'
import { type NetClient, createNetClient, readBody } from '../shared/net/client'
import type { DomainRegistry } from './domains/registry'
import { createStreamGuard } from './online/stream/guard'

/** 登记 NAS 直播：远程列表、线路探测与 XMLTV；不开放宿主文件读取。 */
export function registerServerIptv(
  registry: DomainRegistry,
  options: {
    dataDir: string
    allowPrivate: string[]
    net?: NetClient
  }
): void {
  const net =
    options.net ??
    createNetClient({
      fetch: (url, init) => fetch(url, init),
      lookup: host => lookup(host, { all: true }),
      guard: createStreamGuard(options.allowPrivate),
    })
  const download = async (url: string, maxBytes: number): Promise<Buffer> => {
    const { response } = await net.open(url.trim(), { timeoutMs: 30_000 })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    return Buffer.from(await readBody(response, maxBytes))
  }
  const epg = createEpgStore({
    cacheDir: join(options.dataDir, 'iptv', 'epg'),
    download: url => download(url, 64 * 1024 * 1024),
  })
  registry.implement(iptv, {
    fetchPlaylist: async (_, url) => {
      try {
        return {
          ok: true,
          text: decodeSubtitleText(await download(url, PLAYLIST_MAX_BYTES)),
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
    probeStream: (_, url) => probeStream(net, url.trim()),
    pickPlaylistFile: () => ({
      ok: false,
      error: '网页端请通过播放列表地址添加直播源',
    }),
    readPlaylistFile: () => ({
      ok: false,
      error: '网页端不读取服务器本地文件，请使用播放列表地址',
    }),
    loadEpg: (_, url, force) => epg.load(url.trim(), force),
    epgProgrammes: async (_, url, queries, from, to) => {
      try {
        return {
          ok: true,
          data: await epg.programmes(url.trim(), queries, from, to),
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
  })
}
