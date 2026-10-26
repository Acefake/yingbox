/**
 * 资源来源：界面搜索（PanSou 的 115 分享 + 磁力 + 电驴，Torznab 的磁力，并发问）与 Torznab 配置的存取 / 测试。
 *
 * - 只填了一个来源时只问那一个；两个都没填返回去设置的提示；
 * - 一个来源失败只记一条说明（notes），另一个照常出结果；全部失败才整体失败；
 * - 磁力按哈希合并（Torznab 的带做种数，优先），按做种数、大小排序，有上限（magnet-link.ts）；
 * - Torznab API Key 只在这里读写，渲染层只拿到地址与 hasKey。
 */
import type {
  MagnetItem,
  NetdiskItem,
  NetdiskSearchResult,
  Pan115Result,
  TorznabConfig,
} from '../../shared/contract/pan115'
import { Pan115Error } from './errors'
import type { FetchLike } from './http'
import { mergeMagnets } from './magnet-link'
import { searchPanSou } from './pansou'
import { searchTorznab, testTorznab } from './torznab'
import { type TorznabSecret, cleanTorznabUrls } from './torznab-secret'

const NO_SOURCE = '请先在设置 · 网盘里填写 PanSou 或 Torznab 地址'

/** 依赖（网盘服务依赖的子集） */
export interface SourceDeps {
  lanFetch: FetchLike
  settings: { pansouUrl(): string }
  torznab: {
    read(): TorznabSecret | null
    write(value: TorznabSecret | null): Promise<void>
  }
}

/** 来源搜索与 Torznab 配置 */
export interface SourceSearch {
  search(keyword: string): Promise<Pan115Result<NetdiskSearchResult>>
  torznab(): Promise<TorznabConfig>
  /** apiKey 为 null 时保留已保存的 Key，空串清除 */
  setTorznab(urls: string[], apiKey: string | null): Promise<Pan115Result>
  testTorznab(
    urls: string[],
    apiKey: string | null
  ): Promise<Pan115Result<{ lines: string[] }>>
}

/** 异常 → 一句人话 */
function reasonOf(error: unknown): string {
  return error instanceof Pan115Error
    ? error.message
    : `请求失败：${(error as Error).message}`
}

/** 创建来源搜索 */
export function createSourceSearch(deps: SourceDeps): SourceSearch {
  /** null = 用已保存的 Key */
  const keyOf = (apiKey: string | null): string =>
    apiKey === null ? (deps.torznab.read()?.apiKey ?? '') : apiKey.trim()

  return {
    async search(keyword) {
      const base = deps.settings.pansouUrl().trim()
      const torznab = deps.torznab.read()
      const hasTorznab = Boolean(torznab?.urls.length)
      if (!base && !hasTorznab) return { ok: false, error: NO_SOURCE }
      if (!keyword.trim()) return { ok: false, error: '请输入关键词' }
      const [pansou, indexers] = await Promise.allSettled([
        base ? searchPanSou(deps.lanFetch, base, keyword, true) : null,
        torznab && hasTorznab
          ? searchTorznab(deps.lanFetch, torznab.urls, torznab.apiKey, {
              q: keyword,
            })
          : null,
      ])
      const reasons: string[] = []
      const notes: string[] = []
      const magnets: MagnetItem[][] = []
      let items: NetdiskItem[] = []
      if (indexers.status === 'rejected')
        reasons.push(reasonOf(indexers.reason))
      else if (indexers.value) {
        magnets.push(indexers.value.magnets)
        notes.push(...indexers.value.notes)
      }
      if (pansou.status === 'rejected') reasons.unshift(reasonOf(pansou.reason))
      else if (pansou.value) {
        items = pansou.value.shares
        magnets.push(pansou.value.magnets)
      }
      if (reasons.length === Number(Boolean(base)) + Number(hasTorznab))
        return { ok: false, error: reasons.join('；') }
      return {
        ok: true,
        items,
        magnets: mergeMagnets(magnets),
        notes: [...reasons, ...notes],
      }
    },

    async torznab() {
      const saved = deps.torznab.read()
      return { urls: saved?.urls ?? [], hasKey: Boolean(saved?.apiKey) }
    },

    async setTorznab(urls, apiKey) {
      try {
        const lines = cleanTorznabUrls(urls)
        const key = keyOf(apiKey)
        await deps.torznab.write(
          lines.length || key ? { urls: lines, apiKey: key } : null
        )
        return { ok: true }
      } catch (error) {
        return { ok: false, error: reasonOf(error) }
      }
    },

    async testTorznab(urls, apiKey) {
      const lines = cleanTorznabUrls(urls)
      if (!lines.length) return { ok: false, error: '请先填写 Torznab 地址' }
      const result = await testTorznab(deps.lanFetch, lines, keyOf(apiKey))
      return result.ok
        ? { ok: true, lines: result.lines }
        : { ok: false, error: result.lines.join('\n') }
    },
  }
}
