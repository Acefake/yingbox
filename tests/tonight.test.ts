import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UseTonight } from '../src/renderer/src/features/library/tonight/use-tonight'

import type { LibraryItemNode } from '../src/shared/library/ipc'
import {
  CANDIDATE_LIMIT,
  type TonightCandidate,
  candidateMeta,
  compactCandidate,
  episodeMinutes,
  fitsTime,
  movieCandidate,
  samplePool,
  selectCandidates,
  seriesCandidate,
} from '../src/renderer/src/features/library/tonight/tonight-rules'
import {
  PICK_COUNT,
  buildTonightMessages,
  completePicks,
  localPicks,
  localReason,
  matchesMood,
  nextExclude,
  validatePicks,
} from '../src/renderer/src/features/library/tonight/tonight-picks'

/**
 * 「今晚看什么」：候选筛选（看完 / 时长 / 在看 / 排除）、精简、模型结果校验、本地兜底、换一批，
 * 以及 use-tonight 在 AI 正常 / 未配置 / 出错时的走向（AI 与读库都 mock）。
 */

function node(over: Partial<LibraryItemNode> = {}): LibraryItemNode {
  return {
    id: 1,
    libraryId: 1,
    type: 'movie',
    title: '记忆碎片',
    originalTitle: null,
    year: 2000,
    matchState: 'auto',
    providerIds: {},
    poster: null,
    backdrop: null,
    rating: 8.6,
    addedAt: 0,
    updatedAt: 0,
    seasonNumber: null,
    episodeNumber: null,
    overview: '一个失去短期记忆的男人追查杀妻凶手。',
    logo: null,
    runtime: 113,
    genres: ['悬疑', '惊悚'],
    airDate: null,
    metadata: null,
    files: [{ id: 9, path: '/m/a.mkv', kind: 'video', size: 1, mtime: 0 }],
    children: [],
    ...over,
  }
}

function cand(over: Partial<TonightCandidate> = {}): TonightCandidate {
  return {
    id: 1,
    kind: 'movie',
    title: '片',
    year: 2020,
    genres: ['剧情'],
    rating: 7,
    minutes: 100,
    overview: '',
    backdrop: null,
    poster: null,
    ...over,
  }
}

describe('候选', () => {
  it('没看完的电影进候选，时长取 runtime', () => {
    const c = movieCandidate(node(), 0)
    expect(c).toMatchObject({ id: 1, kind: 'movie', minutes: 113 })
  })

  it('进度已到片尾的电影排除，没有视频文件的也排除', () => {
    expect(movieCandidate(node(), 113 * 60)).toBeNull()
    expect(movieCandidate(node({ files: [] }), 0)).toBeNull()
  })

  it('看了一半的电影按剩余时长，带继续播放 id', () => {
    const c = movieCandidate(node(), 0, {
      id: 'movie:1',
      progress: 60 * 60,
      duration: 113 * 60,
    })
    expect(c).toMatchObject({ minutes: 53, continueId: 'movie:1' })
  })

  it('在看的剧：一集时长取剧或第一集的 runtime；当前集看了一半算剩余', () => {
    const ep = node({ id: 3, type: 'episode', runtime: 45, children: [] })
    const season = node({
      id: 2,
      type: 'season',
      runtime: null,
      children: [ep],
    })
    const series = node({
      id: 10,
      type: 'series',
      runtime: null,
      files: [],
      children: [season],
    })
    expect(episodeMinutes(series)).toBe(45)
    const next = seriesCandidate(series, {
      id: 'tv:10',
      progress: 0,
      duration: 0,
      nextUp: true,
      episode: 'S01E03',
    })
    expect(next).toMatchObject({
      kind: 'series',
      minutes: 45,
      continueId: 'tv:10',
      episode: 'S01E03',
    })
    const half = seriesCandidate(series, {
      id: 'tv:10',
      progress: 20 * 60,
      duration: 44 * 60,
    })
    expect(half?.minutes).toBe(24)
    expect(
      seriesCandidate(node(), { id: 'x', progress: 0, duration: 0 })
    ).toBeNull()
  })

  it('按时长过滤：未知时长只在不限时保留', () => {
    expect(fitsTime(60, 'hour')).toBe(true)
    expect(fitsTime(61, 'hour')).toBe(false)
    expect(fitsTime(119, 'two')).toBe(true)
    expect(fitsTime(null, 'two')).toBe(false)
    expect(fitsTime(null, 'any')).toBe(true)
  })

  it('selectCandidates：排除已推荐、在看的在前、其余按评分、最多 80 条', () => {
    const list = [
      cand({ id: 1, rating: 9 }),
      cand({ id: 2, rating: 5, continueId: 'tv:2', kind: 'series' }),
      cand({ id: 3, rating: 8, minutes: 150 }),
      cand({ id: 4, rating: 7.5 }),
    ]
    const picked = selectCandidates(list, {
      time: 'two',
      exclude: new Set([4]),
    })
    expect(picked.map(c => c.id)).toEqual([2, 1])
    const many = Array.from({ length: 120 }, (_, i) => cand({ id: i + 1 }))
    expect(selectCandidates(many, { time: 'any' })).toHaveLength(
      CANDIDATE_LIMIT
    )
  })

  it('samplePool：前七成按评分，其余随机抽', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    const pool = samplePool(items, 10, () => 0)
    expect(pool).toHaveLength(10)
    expect(pool.slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(new Set(pool).size).toBe(10)
    expect(samplePool([1, 2], 10)).toEqual([1, 2])
  })

  it('精简：只留必要字段，简介截前 80 字，评分一位小数', () => {
    const long = '字'.repeat(200)
    const c = compactCandidate(
      cand({ id: 7, rating: 8.66, overview: long, continueId: 'tv:7' })
    )
    expect(c).toEqual({
      id: 7,
      title: '片',
      year: 2020,
      type: '电影',
      genres: ['剧情'],
      rating: 8.7,
      minutes: 100,
      overview: '字'.repeat(80),
      watching: true,
    })
    expect(Object.keys(compactCandidate(cand()))).not.toContain('backdrop')
  })

  it('卡片信息行', () => {
    expect(candidateMeta(cand({ minutes: 113, year: 2000, rating: 8.6 }))).toBe(
      '113 分钟 · 2000 · 评分 8.6'
    )
    expect(
      candidateMeta(
        cand({
          kind: 'series',
          minutes: 45,
          continueId: 'tv:1',
          episode: 'S01E03',
          year: null,
          rating: null,
        })
      )
    ).toBe('一集 45 分钟 · 在看 S01E03')
  })
})

describe('模型结果校验与兜底', () => {
  const list = [
    cand({ id: 1, rating: 9, genres: ['喜剧'] }),
    cand({ id: 2, rating: 8, genres: ['悬疑'] }),
    cand({ id: 3, rating: 7, genres: ['动作'] }),
    cand({
      id: 4,
      rating: 6,
      genres: ['动画'],
      kind: 'series',
      continueId: 'tv:4',
    }),
  ]

  it('提示里带心情、时长、补充和精简候选', () => {
    const [system, user] = buildTonightMessages(
      { mood: 'brainy', time: 'hour', note: '  想看老片 ' },
      [compactCandidate(list[0])]
    )
    expect(system.role).toBe('system')
    expect(system.content).toContain('正好 3 部')
    expect(user.content).toContain('心情：烧脑')
    expect(user.content).toContain('可用时长：1 小时内')
    expect(user.content).toContain('补充：想看老片')
    expect(user.content).toContain('"id":1')
  })

  it('id 必须在候选里、不重复、理由非空，最多 3 条；字符串 id 也认', () => {
    const picks = validatePicks(
      {
        picks: [
          { id: 99, reason: '不在候选' },
          { id: 2, reason: '倒叙结构，适合动脑。' },
          { id: 2, reason: '重复' },
          { id: 1, reason: '   ' },
          { id: '3', reason: '节奏快' },
          { reason: '没 id' },
          { id: 4, reason: '接着追' },
          { id: 1, reason: '第四条不要' },
        ],
      },
      list
    )
    expect(picks.map(p => [p.candidate.id, p.reason, p.source])).toEqual([
      [2, '倒叙结构，适合动脑。', 'ai'],
      [3, '节奏快', 'ai'],
      [4, '接着追', 'ai'],
    ])
    expect(validatePicks({ nope: 1 }, list)).toEqual([])
    expect(validatePicks(null, list)).toEqual([])
  })

  it('理由截到 60 字', () => {
    const [pick] = validatePicks(
      { picks: [{ id: 1, reason: '好'.repeat(100) }] },
      list
    )
    expect(Array.from(pick.reason)).toHaveLength(60)
  })

  it('不够 3 条时用本地规则补齐，不重复', () => {
    const ai = validatePicks({ picks: [{ id: 3, reason: '刺激' }] }, list)
    const full = completePicks(ai, list, null, () => 0)
    expect(full).toHaveLength(PICK_COUNT)
    expect(full[0]).toMatchObject({ source: 'ai' })
    expect(full.slice(1).every(p => p.source === 'local')).toBe(true)
    expect(new Set(full.map(p => p.candidate.id)).size).toBe(3)
    expect(full.slice(1).map(p => p.candidate.id)).not.toContain(3)
  })

  it('本地推荐：评分 + 心情类型加分 + 下饭偏好剧集', () => {
    expect(matchesMood(list[1], 'brainy')).toBe(true)
    expect(matchesMood(list[0], 'brainy')).toBe(false)
    expect(matchesMood(list[0], null)).toBe(false)
    const brainy = localPicks(list, 'brainy', 1, () => 0)
    expect(brainy[0].candidate.id).toBe(2)
    const meal = localPicks(list, 'meal', 3, () => 0)
    expect(meal.map(p => p.candidate.id)).toEqual([1, 4, 2])
    expect(localPicks(list, null, 3, () => 0).map(p => p.candidate.id)).toEqual(
      [1, 2, 3]
    )
  })

  it('本地理由', () => {
    expect(localReason(list[1], 'brainy')).toBe(
      '悬疑，评分 8.0，适合想动动脑的时候。'
    )
    expect(localReason(list[3], null)).toBe(
      '动画，评分 6.0，正在追，接着看下一段。'
    )
    expect(localReason(cand({ genres: [], rating: null }), null)).toBe(
      '库里值得一看的一部。'
    )
  })

  it('换一批：剩下不够一批时从头再来', () => {
    expect(nextExclude(new Set([1, 2, 3]), 5)).toEqual({
      exclude: new Set([1, 2, 3]),
      reset: false,
    })
    expect(nextExclude(new Set([1, 2, 3]), 2)).toEqual({
      exclude: new Set(),
      reset: true,
    })
    expect(nextExclude(new Set(), 0).reset).toBe(false)
  })
})

// —— use-tonight：mock AI 与读库 ——

const ai = vi.hoisted(() => ({
  available: true,
  chatJson: vi.fn(),
}))
const source = vi.hoisted(() => ({ list: [] as TonightCandidate[] }))

vi.mock('@/features/ai', async () => {
  class AiCallError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  }
  return {
    AiCallError,
    aiAvailable: () => ai.available,
    chatJson: ai.chatJson,
  }
})
vi.mock('../src/renderer/src/features/library/tonight/tonight-source', () => ({
  loadTonightCandidates: async () => source.list,
  watchingRecord: () => null,
}))
vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  errorText: (e: unknown) => String(e),
}))

describe('use-tonight', () => {
  beforeEach(() => {
    ai.available = true
    ai.chatJson.mockReset()
    source.list = Array.from({ length: 5 }, (_, i) =>
      cand({ id: i + 1, rating: 9 - i, minutes: 90 })
    )
  })

  async function setup(): Promise<UseTonight> {
    const { useTonight } =
      await import('../src/renderer/src/features/library/tonight/use-tonight')
    return useTonight()
  }

  it('AI 正常：发精简候选，返回 3 条推荐', async () => {
    ai.chatJson.mockResolvedValue({
      data: {
        picks: [
          { id: 5, reason: '理由五' },
          { id: 2, reason: '理由二' },
          { id: 4, reason: '理由四' },
        ],
      },
    })
    const t = await setup()
    t.mood.value = 'brainy'
    await t.recommend(true)
    expect(t.picks.value.map(p => p.candidate.id)).toEqual([5, 2, 4])
    expect(t.notice.value).toBeNull()
    const [request, options] = ai.chatJson.mock.calls[0]
    expect(request.messages[1].content).toContain('心情：烧脑')
    expect(request.schema).toBeTruthy()
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('换一批排除已推荐的；候选不够时从头再来', async () => {
    ai.chatJson.mockImplementation(
      async (request: { messages: { content: string }[] }) => {
        const json = request.messages[1].content.split('\n').pop() ?? '[]'
        const ids = (JSON.parse(json) as { id: number }[]).map(c => c.id)
        return {
          data: {
            picks: ids.slice(0, 3).map(id => ({ id, reason: `r${id}` })),
          },
        }
      }
    )
    const t = await setup()
    await t.recommend(true)
    expect(t.picks.value.map(p => p.candidate.id)).toEqual([1, 2, 3])
    await t.recommend(false)
    // 只剩 4、5 两条（不够一批）→ 从头再来
    expect(t.picks.value.map(p => p.candidate.id)).toEqual([1, 2, 3])
    expect(t.notice.value?.text).toContain('从头再挑')
    source.list.push(cand({ id: 6, rating: 1, minutes: 90 }))
    await t.recommend(true)
    await t.recommend(false)
    expect(t.picks.value.map(p => p.candidate.id)).toEqual([4, 5, 6])
  })

  it('AI 未配置：本地规则推荐并提示去配置', async () => {
    const { AiCallError } = await import('@/features/ai')
    ai.chatJson.mockRejectedValue(new AiCallError('not_configured', 'no key'))
    const t = await setup()
    await t.recommend(true)
    expect(t.picks.value).toHaveLength(3)
    expect(t.picks.value.every(p => p.source === 'local')).toBe(true)
    expect(t.notice.value).toMatchObject({ configure: true })
  })

  it('不是桌面端：不调 AI，直接本地推荐', async () => {
    ai.available = false
    const t = await setup()
    await t.recommend(true)
    expect(ai.chatJson).not.toHaveBeenCalled()
    expect(t.picks.value).toHaveLength(3)
  })

  it('模型出错：退回本地，不提示配置', async () => {
    ai.chatJson.mockRejectedValue(new Error('boom'))
    const t = await setup()
    await t.recommend(true)
    expect(t.picks.value).toHaveLength(3)
    expect(t.notice.value?.configure).toBeUndefined()
    expect(t.notice.value?.text).toContain('暂时不可用')
  })

  it('时长放不下任何候选：空状态，不调 AI', async () => {
    const t = await setup()
    t.time.value = 'hour'
    await t.recommend(true)
    expect(t.empty.value).toBe(true)
    expect(t.picks.value).toEqual([])
    expect(ai.chatJson).not.toHaveBeenCalled()
  })
})
