/**
 * XMLTV 节目单缓存：按地址下载（.gz 按魔数自动解压）、解析成索引，内存 + 磁盘各存一份，12 小时内复用。
 *
 * 只保留「下载时刻前 1 天 ~ 后 2 天」的节目，控制内存与缓存文件大小。
 * 不 import electron：下载函数与缓存目录由调用方注入，便于单测。
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import type {
  EpgLoadResult,
  EpgProgramme,
  EpgQuery,
} from '../../shared/contract/iptv'
import {
  type EpgIndex,
  type XmltvData,
  buildEpgIndex,
  matchEpgChannel,
  parseXmltv,
  programmesBetween,
} from '../../shared/iptv/xmltv'

/** 缓存有效期：12 小时 */
export const EPG_TTL_MS = 12 * 60 * 60 * 1000
/** 解压后最大字节数（防 gzip 炸弹） */
export const EPG_MAX_XML_BYTES = 256 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

/** 磁盘缓存文件的内容 */
interface EpgCacheFile {
  url: string
  fetchedAt: number
  data: XmltvData
}

/** 内存里的一份节目单 */
interface EpgEntry {
  fetchedAt: number
  channels: number
  index: EpgIndex
}

/** createEpgStore 的依赖 */
export interface EpgStoreDeps {
  /** 下载原始字节（调用方负责 SSRF 防护与大小上限） */
  download: (url: string) => Promise<Buffer>
  /** 磁盘缓存目录 */
  cacheDir: string
  now?: () => number
}

/** 节目单仓库 */
export interface EpgStore {
  load: (url: string, force: boolean) => Promise<EpgLoadResult>
  programmes: (
    url: string,
    queries: EpgQuery[],
    from: number,
    to: number
  ) => Promise<Record<string, EpgProgramme[]>>
}

/** 字节 → XML 文本：gzip 魔数 1f 8b 则先解压 */
export function decodeEpgBytes(bytes: Buffer): string {
  const xml =
    bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes, { maxOutputLength: EPG_MAX_XML_BYTES })
      : bytes
  return xml.toString('utf8')
}

/** 缓存文件名：地址的 sha1 */
const cacheName = (url: string): string =>
  `${createHash('sha1').update(url).digest('hex')}.json`

/** 创建节目单仓库 */
export function createEpgStore(deps: EpgStoreDeps): EpgStore {
  const now = deps.now ?? Date.now
  const memory = new Map<string, EpgEntry>()
  /** 同一地址的加载合并成一次 */
  const inflight = new Map<string, Promise<EpgEntry>>()

  const toEntry = (fetchedAt: number, data: XmltvData): EpgEntry => ({
    fetchedAt,
    channels: data.channels.length,
    index: buildEpgIndex(data),
  })

  const readDisk = async (url: string): Promise<EpgCacheFile | null> => {
    try {
      const raw = await fs.readFile(join(deps.cacheDir, cacheName(url)), 'utf8')
      const file = JSON.parse(raw) as EpgCacheFile
      return file.url === url && file.data ? file : null
    } catch {
      return null
    }
  }

  const writeDisk = async (file: EpgCacheFile): Promise<void> => {
    try {
      await fs.mkdir(deps.cacheDir, { recursive: true })
      const target = join(deps.cacheDir, cacheName(file.url))
      const temporary = `${target}.partial`
      await fs.writeFile(temporary, JSON.stringify(file))
      await fs.rename(temporary, target)
    } catch (error) {
      console.warn('[iptv] 节目单缓存写入失败', (error as Error).message)
    }
  }

  const fresh = (fetchedAt: number): boolean => now() - fetchedAt < EPG_TTL_MS

  const fetchEntry = async (url: string, force: boolean): Promise<EpgEntry> => {
    if (!force) {
      const cached = memory.get(url)
      if (cached && fresh(cached.fetchedAt)) return cached
      const disk = await readDisk(url)
      if (disk && fresh(disk.fetchedAt)) {
        const entry = toEntry(disk.fetchedAt, disk.data)
        memory.set(url, entry)
        return entry
      }
    }
    const fetchedAt = now()
    const xml = decodeEpgBytes(await deps.download(url))
    const data = parseXmltv(xml, {
      from: fetchedAt - DAY_MS,
      to: fetchedAt + 2 * DAY_MS,
    })
    if (!data.channels.length && !Object.keys(data.programmes).length)
      throw new Error('不是有效的 XMLTV 节目单')
    const entry = toEntry(fetchedAt, data)
    memory.set(url, entry)
    void writeDisk({ url, fetchedAt, data })
    return entry
  }

  const ensure = (url: string, force: boolean): Promise<EpgEntry> => {
    const running = inflight.get(url)
    if (running) return running
    const task = fetchEntry(url, force).finally(() => inflight.delete(url))
    inflight.set(url, task)
    return task
  }

  return {
    async load(url, force) {
      try {
        const entry = await ensure(url, force)
        return {
          ok: true,
          fetchedAt: entry.fetchedAt,
          channels: entry.channels,
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
    async programmes(url, queries, from, to) {
      const entry = await ensure(url, false)
      const out: Record<string, EpgProgramme[]> = {}
      for (const query of queries) {
        const id = matchEpgChannel(entry.index, query)
        const list = id ? entry.index.programmes.get(id) : undefined
        if (list?.length) out[query.key] = programmesBetween(list, from, to)
      }
      return out
    },
  }
}
