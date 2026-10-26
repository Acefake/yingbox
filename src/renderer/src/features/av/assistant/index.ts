/**
 * AI 助手的私密技能包（只在成人模式打开时由应用入口动态 import 并登记，独立 chunk）。
 *
 * 只在私密模式（番号库 / AV 页面，或在播私密内容）生效；助手核心对私密模式的所有请求
 * 带 private + localOnly，只发给本地模型，对话只留在内存里。跳到番号库做自然语言搜索时
 * 也带上 localOnly（privateSearchQuery），该页的模型请求同样只发给本地模型。
 * 私密的「继续播放」板块来自路由表（privateRouteSections），与助手核心同一份名单。本阶段只做文本能力：
 * 按番号搜索 / 跳到详情、私密库自然语言搜索、继续播放私密记录、用去码模式播放、随机一部。
 */
import {
  type AssistantMediaCard,
  type AssistantSkill,
  cardInfos,
  closeOutcome,
  continueCardsWhere,
  defineAction,
  privateRouteSections,
  withLibraryInfo,
} from '@/features/assistant'
import { useLadaTasks } from '@/features/lada'
import {
  findLibraryItems,
  libraryItemVideo,
  libraryPoster,
  playLibraryItem,
  randomLibraryItem,
} from '@/features/library'

import { formatRating } from '../../../../../shared/library/rating'

import {
  PRIVATE_LIBRARY,
  currentItemId,
  exactCodeMatch,
  normalizeCode,
  privateSearchQuery,
} from './av-skill-rules'

const code = defineAction<string>({
  name: 'code',
  describe:
    '按番号找片或打开番号详情；target 写番号（如 ABC-123，可以不带横杠）。',
  parse: raw => normalizeCode(raw.target || raw.text),
  async run(value, env) {
    const found = await findLibraryItems(PRIVATE_LIBRARY.section, value)
    const hit = found ? exactCodeMatch(found.items, value) : null
    await env.router.push({
      path: PRIVATE_LIBRARY.path,
      query: hit ? { item: String(hit.id) } : { q: value },
    })
    return closeOutcome
  },
})

const search = defineAction<string>({
  name: 'search',
  describe:
    '在番号库里按描述找片（演员、类型、年份、有码无码等）；text 写筛选描述。',
  parse: raw => raw.text || null,
  async run(text, env) {
    await env.router.push({
      path: PRIVATE_LIBRARY.path,
      query: privateSearchQuery(text),
    })
    return closeOutcome
  },
})

const resume = defineAction<true>({
  name: 'continue',
  describe: '接着看上次没看完的番号或在线资源。',
  parse: () => true,
  async run(_params, env) {
    const sections = privateRouteSections(env.router)
    const cards = await continueCardsWhere(section => sections.has(section))
    return {
      message: cards.length ? '接着看上次没看完的：' : '还没有看到一半的内容。',
      result: cards.length ? { kind: 'cards', cards } : null,
    }
  },
})

const restore = defineAction<string>({
  name: 'restore',
  describe:
    '用去码（边跑边看）模式播放；target 写番号，留空表示当前打开的那部。',
  parse: raw => (raw.target ? (normalizeCode(raw.target) ?? null) : ''),
  async run(value, env) {
    let id = value ? null : currentItemId(env.router.currentRoute.value)
    if (value) {
      const found = await findLibraryItems(PRIVATE_LIBRARY.section, value)
      id = found ? (exactCodeMatch(found.items, value)?.id ?? null) : null
    }
    if (id === null)
      return {
        message: value
          ? `番号库里没找到 ${value}。`
          : '先打开一部番号详情，或告诉我番号。',
        result: null,
      }
    const path = await libraryItemVideo(id)
    if (!path)
      return { message: '这部没有能处理的本地视频文件。', result: null }
    void useLadaTasks().startLive(path)
    return closeOutcome
  },
})

const random = defineAction<true>({
  name: 'random',
  describe: '从番号库里随机挑一部。',
  parse: () => true,
  async run() {
    const item = await randomLibraryItem(PRIVATE_LIBRARY.section)
    if (!item) return { message: '番号库里还没有片子。', result: null }
    const [info] = await cardInfos([item.id])
    const card: AssistantMediaCard = withLibraryInfo(
      {
        id: String(item.id),
        title: item.title,
        image: libraryPoster(item.poster),
        meta: item.year ? String(item.year) : '',
        rating: formatRating(item.rating, item.ratingSource),
        source: '本地片库',
        playLabel: '播放',
        play: () => playLibraryItem(item.id),
      },
      info
    )
    return {
      message: `随机挑了一部：${item.title}`,
      result: { kind: 'cards', cards: [card] },
    }
  },
})

/** 私密技能包 */
const privateLibrarySkill: AssistantSkill = {
  id: 'private',
  scope: 'private',
  actions: [code, search, resume, restore, random],
  placeholder: '搜索或问私密库…',
  prompt: () => [
    '当前是私密模式：只在本地模型上运行，不要在回答里复述片名之外的个人信息。',
  ],
  suggestions: context =>
    context.playing
      ? []
      : ['按番号搜 ABC-123', '只看无码', '用去码模式播放', '随机来一部'],
}

export default privateLibrarySkill
