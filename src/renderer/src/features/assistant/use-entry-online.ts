/**
 * 统一入口里的在线影视源搜索：复用在线搜索页同一套（CMS + 插件源，features/online 的 useOnlineSearch）。
 * - 本地结果先出：输入停 {@link ONLINE_DELAY_MS} 再搜，继续打字就换成新的一轮（旧的一轮结果不再追加）；
 * - 各源异步追加，同名同年的多个源合成一行（「在线 · 3 个源」），最多 {@link ONLINE_LIMIT} 行；
 * - 打开：收起浮层、跳到在线页，再请在线页打开这条的详情（与追剧日历相同的交接方式）。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  nextTick,
  onScopeDispose,
  ref,
  watch,
} from 'vue'
import { useRouter } from 'vue-router'

import { type LocalTitle, normalizeTitle, rankOnline } from './result-rank'
import {
  type CmsItem,
  requestOnlineDetail,
  useOnlineSearch,
} from '@/features/online'

/** 输入停多久再搜在线源 */
export const ONLINE_DELAY_MS = 450
/** 最多显示几行在线结果 */
export const ONLINE_LIMIT = 12
/** 排序前先合并的候选行数（相关的结果可能排在各源返回的后面） */
const ONLINE_POOL = 60
/** 展开「更多相关」后最多再显示几行 */
const MORE_LIMIT = 20

/** 一行在线结果（同名同年的多个源合并） */
export interface OnlineRow {
  key: string
  title: string
  year: string
  cover: string
  /** 分类（电影、剧集…；第一个给出的源） */
  type: string
  /** 各源的备注（清晰度、更新到第几集；去重） */
  remarks: string[]
  /** 来源站点名（去重） */
  sources: string[]
  /** 打开详情用的那一条（第一个返回的源） */
  item: CmsItem
}

/** 备注去空白、去重后追加 */
function addRemark(list: string[], remark: string | undefined): string[] {
  const text = remark?.trim()
  if (text && !list.includes(text)) list.push(text)
  return list
}

/**
 * 把各源返回的条目按「片名 + 年份」合成行，保持首次出现的顺序。
 * @param items 在线搜索结果（按返回顺序）
 * @param limit 最多几行
 */
export function groupOnline(
  items: CmsItem[],
  limit = ONLINE_LIMIT
): OnlineRow[] {
  const rows = new Map<string, OnlineRow>()
  for (const item of items) {
    const title = item.vod_name?.trim()
    if (!title) continue
    const key = `${normalizeTitle(title)}|${item.vod_year ?? ''}`
    const row = rows.get(key)
    const source = item.source_name || item._siteName || ''
    if (row) {
      if (source && !row.sources.includes(source)) row.sources.push(source)
      if (!row.cover && item.vod_pic) row.cover = item.vod_pic
      if (!row.type && item.type_name) row.type = item.type_name
      addRemark(row.remarks, item.vod_remarks)
      continue
    }
    if (rows.size >= limit) continue
    rows.set(key, {
      key,
      title,
      year: item.vod_year ?? '',
      cover: item.vod_pic ?? '',
      type: item.type_name?.trim() ?? '',
      remarks: addRemark([], item.vod_remarks),
      sources: source ? [source] : [],
      item,
    })
  }
  return [...rows.values()]
}

export interface EntryOnline {
  /** 显示的行：相关度排序后的正片相关结果，展开「更多相关」后接上折叠的那些 */
  rows: ComputedRef<OnlineRow[]>
  /** 折叠着的「更多相关」条数（已展开或没有为 0） */
  hidden: ComputedRef<number>
  /** 展开「更多相关」 */
  expand(): void
  /** 因与本地片库重复而去掉的条数 */
  merged: ComputedRef<number>
  busy: ComputedRef<boolean>
  /** 当前查询的请求失败或源不可用提示 */
  message: ComputedRef<string>
  open(row: OnlineRow): void
}

/**
 * @param text 输入（去掉首尾空白）
 * @param enabled 范围包含在线且在搜索
 * @param locals 本地片库已命中的作品（同名同年的在线结果不再重复列出）
 * @param leave 收起浮层
 */
export function useEntryOnline(options: {
  text: () => string
  enabled: () => boolean
  locals?: () => LocalTitle[]
  leave: () => void
}): EntryOnline {
  const router = useRouter()
  const {
    results,
    loading,
    keyword,
    error,
    failedSources,
    skippedPlugins,
    skippedCms,
    search,
  } = useOnlineSearch()
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(
    [options.text, options.enabled],
    ([text, enabled]) => {
      clearTimeout(timer)
      if (!enabled || !text) return
      timer = setTimeout(() => void search(text), ONLINE_DELAY_MS)
    },
    { immediate: true }
  )
  onScopeDispose(() => clearTimeout(timer))

  /** 只显示与当前输入同一轮的结果 */
  const current = (): boolean =>
    options.enabled() && keyword.value === options.text()
  /** 展开了「更多相关」（换关键词后收回去） */
  const expanded: Ref<boolean> = ref(false)
  watch(options.text, () => (expanded.value = false))
  const ranked = computed(() =>
    rankOnline(
      current() ? groupOnline(results.value, ONLINE_POOL) : [],
      options.text(),
      options.locals?.() ?? []
    )
  )
  const rows = computed(() => {
    const main = ranked.value.main.slice(0, ONLINE_LIMIT)
    return expanded.value
      ? [...main, ...ranked.value.more.slice(0, MORE_LIMIT)]
      : main
  })
  const hidden = computed(() => (expanded.value ? 0 : ranked.value.more.length))
  const merged = computed(() => ranked.value.merged)
  const busy = computed(
    () =>
      options.enabled() && (loading.value || keyword.value !== options.text())
  )
  const message = computed(() => {
    if (!current() || loading.value) return ''
    if (error.value) return error.value
    const count =
      failedSources.value.length +
      skippedPlugins.value.length +
      skippedCms.value.length
    return count ? `${count} 个在线源请求失败或暂不可用` : ''
  })

  function open(row: OnlineRow): void {
    options.leave()
    void router.push('/').then(async () => {
      // 等在线页处理完路由变化（切标签会关掉详情层）再请它打开详情
      await nextTick()
      requestOnlineDetail(row.item)
    })
  }

  return {
    rows,
    hidden,
    merged,
    expand: () => (expanded.value = true),
    busy,
    message,
    open,
  }
}
