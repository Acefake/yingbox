/**
 * 媒体库技能包（普通模式）：推荐今晚看什么、继续播放、媒体库自然语言搜索。
 *
 * - 推荐：「今晚看什么」同一套逻辑（suggestTonight），卡片带时长 / 类型 / 评分，点击即播；
 * - 继续播放：「继续播放」记录，私密分区的记录不出现（由调用方给出判断），卡片带进度条；
 * - 搜索：跳到媒体库，搜索框写成「? + 描述」强制交给自然语言搜索解析。
 */
import {
  type TonightSuggestion,
  playTonightPick,
  suggestTonight,
} from '@/features/library'

import { continueCardsWhere } from './continue-cards'
import {
  type AssistantMediaCard,
  type AssistantSkill,
  closeOutcome,
  defineAction,
} from './skill-types'

/** 时长写成「1h 39m」/「45m」（先取整到分钟再拆，59.6 分钟写 1h 00m） */
export function durationBadge(minutes: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined
  const total = Math.max(1, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** 一条推荐 → 卡片 */
export function pickCard(item: TonightSuggestion): AssistantMediaCard {
  const meta = [item.genre, item.rating ? item.rating.toFixed(1) : '']
    .filter(Boolean)
    .join(' · ')
  return {
    id: String(item.pick.candidate.id),
    title: item.title,
    image: item.image,
    badge: durationBadge(item.minutes),
    meta: meta || item.meta,
    reason: item.reason,
    playLabel: item.resume ? '继续播放' : '播放',
    play: () => playTonightPick(item.pick),
  }
}

/** 媒体库分区 → 页面路径 */
const SECTION_PATHS = { movie: '/movie', tv: '/tv' } as const

/** 搜索参数 */
interface SearchParams {
  section: keyof typeof SECTION_PATHS
  query: string
}

/**
 * 新建媒体库技能包。
 * @param isPrivateSection 判断「继续播放」记录所在板块是不是私密分区（这些记录不出现）
 */
export function createLibrarySkill(
  isPrivateSection: (section: string) => boolean
): AssistantSkill {
  const recommend = defineAction<string>({
    name: 'recommend',
    describe:
      '想让你推荐今晚看什么；text 写用户的要求原话（心情、类型、时长）。',
    parse: raw => raw.text,
    async run(note, env) {
      const { suggestions, notice } = await suggestTonight(note, env.signal)
      const cards = suggestions.map(pickCard)
      return {
        message:
          notice ??
          (cards.length
            ? '今晚可以看看这几部。'
            : '媒体库里暂时挑不出合适的片子，先扫描或刮削一下媒体库吧。'),
        result: cards.length ? { kind: 'cards', cards } : null,
      }
    },
  })

  const resume = defineAction<true>({
    name: 'continue',
    describe: '想接着看上次没看完的。',
    parse: () => true,
    async run() {
      const cards = continueCardsWhere(section => !isPrivateSection(section))
      return {
        message: cards.length
          ? '接着看上次没看完的：'
          : '还没有看到一半的内容。',
        result: cards.length ? { kind: 'cards', cards } : null,
      }
    },
  })

  const search = defineAction<SearchParams>({
    name: 'search',
    describe:
      '在本地媒体库里找片；target 为 movie 或 tv，text 写筛选描述（如「90 年代的高分港片」）。',
    parse: raw =>
      raw.text && (raw.target === 'movie' || raw.target === 'tv')
        ? { section: raw.target, query: raw.text }
        : null,
    async run(params, env) {
      await env.router.push({
        path: SECTION_PATHS[params.section],
        query: { q: `?${params.query}` },
      })
      return closeOutcome
    },
  })

  return {
    id: 'library',
    scope: 'normal',
    actions: [recommend, resume, search],
    suggestions: context =>
      context.playing
        ? []
        : ['今晚看什么', '继续上次看的', '找 90 年代的高分港片'],
  }
}
