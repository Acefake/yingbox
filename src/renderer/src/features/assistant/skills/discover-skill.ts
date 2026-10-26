/**
 * 库外发现技能包（普通模式、只在桌面端）：本地库没有或不够时，按豆瓣筛选找片。
 *
 * - 模型把描述转成豆瓣筛选（类型、地区、年代、排序、评分下限），豆瓣出片单，TMDB 只对 id，和本地库去重；
 * - 库里已有的照常给「播放」卡片；库外的卡片标「未入库」，带「找 115 资源」（在卡片下方展开候选面板，
 *   用户点「转存」才存）和「在线看」（跳到在线搜索）；
 * - 转存后角标随状态变成「入库中 / 已转存，等待入库 / 已入库」，入库后按钮变成「播放」。
 * - 豆瓣年代档表达不了的范围（70 年代等落到「更早」）按年份再筛一遍；
 * - 回复里的「本地库里有 N 部」是真实数量，卡片只列前几部时会说明。
 * 剧集第一版只给「在线看」。私密模式下本技能不生效。
 */
import type { Router } from 'vue-router'

import {
  DiscoverCandidates,
  type DiscoverResult,
  type DiscoverTitle,
  discoverAvailable,
  discoverEntry,
  discoverTitles,
  parseDiscoverQuery,
  phaseLabel,
  requestedYears,
} from '@/features/discover'
import {
  type LibraryCardInfo,
  libraryPoster,
  playLibraryItem,
} from '@/features/library'

import type { DoubanQuery } from '../../../../../shared/douban/query'
import { cardInfos, withLibraryInfo } from './card-info'
import {
  type AssistantCardAction,
  type AssistantMediaCard,
  type AssistantSkill,
  defineAction,
} from './skill-types'

/** 库里已有的最多给几张 */
const MAX_LOCAL = 3
/** 库外的最多给几张 */
const MAX_MISSING = 6

/** discover 动作的参数：豆瓣条件 + 豆瓣档表达不了时的年份范围 */
export interface DiscoverParams {
  query: DoubanQuery
  years: [number, number] | null
}

/** 年份在不在范围里（没有范围时都算在；有范围时年份未知的不算） */
export function inYears(
  year: number | null,
  years: [number, number] | null
): boolean {
  if (!years) return true
  return year !== null && year >= years[0] && year <= years[1]
}

/**
 * 库里已有的一部 → 播放卡片。
 * @param info 片库条目的卡片信息（说明行、规格标签、详情 / 想看）；取不到为 null
 */
export function localCard(
  entry: DiscoverResult['local'][number],
  info: LibraryCardInfo | null = null
): AssistantMediaCard {
  const { item } = entry
  return withLibraryInfo(
    {
      id: `lib-${item.id}`,
      title: item.title,
      image: libraryPoster(item.poster),
      meta: item.year ? String(item.year) : '',
      rating: entry.title.rate ? `豆瓣 ${entry.title.rate}` : '',
      source: '本地片库',
      playLabel: '播放',
      play: () => playLibraryItem(item.id),
    },
    info
  )
}

/** 库外的一部：随入库状态变化的按钮 */
export function missingActions(
  title: DiscoverTitle,
  router: Router
): AssistantCardAction[] {
  const entry = discoverEntry(title)
  if (entry?.phase === 'done' && entry.itemId !== null) {
    const itemId = entry.itemId
    return [
      { label: '播放', primary: true, run: () => playLibraryItem(itemId) },
    ]
  }
  const actions: AssistantCardAction[] = []
  if (title.kind === 'movie')
    actions.push({
      label: '找 115 资源',
      primary: true,
      panel: { component: DiscoverCandidates, props: { target: title } },
    })
  actions.push({
    label: '在线看',
    run: async () => {
      await router.push({ path: '/', query: { tab: 'search', q: title.title } })
      return true
    },
  })
  return actions
}

/** 库外的一部 → 「未入库」卡片 */
export function missingCard(
  title: DiscoverTitle,
  router: Router
): AssistantMediaCard {
  return {
    id: `db-${title.doubanId}`,
    title: title.title,
    image: title.cover || null,
    meta: title.year ? String(title.year) : '',
    rating: title.rate ? `豆瓣 ${title.rate}` : '',
    source: '豆瓣',
    playLabel: '找资源',
    play: async () => false,
    tag: () => phaseLabel(discoverEntry(title)),
    actions: () => missingActions(title, router),
  }
}

/**
 * 结果 → 一句话。
 * @param local 库里已有的真实数量（不是卡片数）
 * @param missing 库外的数量
 */
export function discoverMessage(
  local: number,
  missing: number,
  kind: DoubanQuery['kind']
): string {
  if (!local && !missing) return '豆瓣上没找到符合条件的片子，换个说法试试。'
  const tail =
    kind === 'tv' ? '剧集暂时只能在线看。' : '点「找 115 资源」挑一个转存。'
  const shown = local > MAX_LOCAL ? `（先列 ${MAX_LOCAL} 部）` : ''
  if (!missing) return `这些本地库里都有${shown}，直接播放吧。`
  if (!local) return `本地库里还没有，这几部可以考虑：${tail}`
  return `本地库里有 ${local} 部${shown}，另外这几部还没入库：${tail}`
}

/** 新建库外发现技能包 */
export function createDiscoverSkill(): AssistantSkill {
  const discover = defineAction<DiscoverParams>({
    name: 'discover',
    describe:
      '想找片且本地库里可能没有（如「找几部 90 年代的科幻片」）；target 为 movie 或 tv，' +
      'command 写豆瓣筛选「类型=科幻;地区=美国;年代=90年代;排序=评分」（各项可省，排序可选综合 / 热度 / 时间 / 评分），' +
      'value 可给评分下限 6–9，不限时为 null。',
    parse: raw => {
      const query = parseDiscoverQuery(raw.target, raw.command, raw.value)
      return query ? { query, years: requestedYears(raw.command) } : null
    },
    gate: () =>
      discoverAvailable
        ? null
        : { kind: 'explain', text: '库外找片只在桌面端可用。' },
    async run({ query, years }, env) {
      const found = await discoverTitles(query, env.signal)
      const local = found.local.filter(e => inYears(e.title.year, years))
      const missing = found.missing.filter(t => inYears(t.year, years))
      const shown = local.slice(0, MAX_LOCAL)
      const infos = await cardInfos(shown.map(entry => entry.item.id))
      const cards = [
        ...shown.map((entry, i) => localCard(entry, infos[i])),
        ...missing.slice(0, MAX_MISSING).map(t => missingCard(t, env.router)),
      ]
      return {
        message: discoverMessage(
          local.length,
          Math.min(missing.length, MAX_MISSING),
          query.kind
        ),
        result: cards.length ? { kind: 'cards', cards } : null,
      }
    },
  })

  return {
    id: 'discover',
    scope: 'normal',
    actions: [discover],
    suggestions: context => (context.playing ? [] : ['找几部 90 年代的科幻片']),
  }
}
