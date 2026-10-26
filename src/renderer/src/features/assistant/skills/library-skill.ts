/**
 * 媒体库技能包（普通模式）：继续播放、媒体库自然语言搜索。
 *
 * - 继续播放：「继续播放」记录，私密分区的记录不出现（由调用方给出判断），卡片带进度条；
 * - 搜索：跳到媒体库，搜索框写成「? + 描述」强制交给自然语言搜索解析。
 */
import { continueCardsWhere } from './continue-cards'
import { type AssistantSkill, closeOutcome, defineAction } from './skill-types'

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
  const resume = defineAction<true>({
    name: 'continue',
    describe: '想接着看上次没看完的。',
    parse: () => true,
    async run() {
      const cards = await continueCardsWhere(
        section => !isPrivateSection(section)
      )
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
    actions: [resume, search],
    suggestions: context =>
      context.playing ? [] : ['继续上次看的', '找 90 年代的高分港片'],
  }
}
