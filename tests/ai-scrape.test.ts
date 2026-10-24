/**
 * AI 识别兜底：提示词构造、模型输出校验、TMDB 验证的采用规则、推断缓存与限速、
 * 执行流程（mock 大模型与 TMDB）、界面规则。
 */
import { describe, expect, it, vi } from 'vitest'
import { LibraryService } from '../src/main/library/engine/service'
import { type IdentifyResult, identify } from '../src/shared/library/identify'
import type {
  Candidate,
  MetadataProvider,
} from '../src/shared/library/provider'
import { parseRpcParams } from '../src/shared/library/ipc'
import {
  AI_GUESS_SCHEMA,
  type AiGuess,
  type LibraryAi,
  SIBLINGS_MAX,
  acceptAiMatch,
  aiCandidates,
  buildGuessRequest,
  createLimiter,
  folderLabel,
  guessCacheKey,
  guessToInput,
  isPrivateSource,
  parseGuess,
} from '../src/main/library/identify/ai/ai-scrape-rules'
import {
  AiScraper,
  requireAiConfigured,
} from '../src/main/library/identify/ai/ai-scraper'
import {
  candidateInfo,
  targetScope,
} from '../src/main/library/identify/identify-rules'
import type { IdentifyTarget } from '../src/main/library/identify/identify-store'
import type { RunnerContext } from '../src/main/library/identify/runner-types'
import { ItemChanges } from '../src/main/library/catalog/catalog-store'
import { MemoryResponseCache } from '../src/main/library/providers/http/provider-cache'
import {
  aiDoneText,
  aiScrapeReady,
  sectionSupportsAi,
  stateSupportsAi,
  sumProgress,
  terminalOf,
} from '../src/renderer/src/features/library/ai-scrape/ai-scrape-rules'
import { tempTree } from './library/engine/helpers'
import { FAKE_TOKEN, FakeTmdb } from './library/providers/fake-tmdb'

// —————————————————————————— 夹具 ——————————————————————————

const HIBIKE: Candidate = {
  ref: { provider: 'tmdb', kind: 'movie', id: '378064' },
  title: '剧场版 吹响吧！上低音号～北宇治高中吹奏乐部欢迎你～',
  originalTitle: '劇場版 響け！ユーフォニアム～北宇治高校吹奏楽部へようこそ～',
  alternativeTitles: ['Sound! Euphonium the Movie', '剧场版 吹响吧！上低音号'],
  year: 2016,
}
const HIBIKE_2017: Candidate = {
  ref: { provider: 'tmdb', kind: 'movie', id: '459488' },
  title: '剧场版 吹响吧！上低音号～想要传达的旋律～',
  year: 2017,
}

/** 假 TMDB：按标题里是否含关键字返回候选。 */
function fakeTmdb(pool: Candidate[]): MetadataProvider & {
  secondaryLanguage?: string
  search: ReturnType<typeof vi.fn>
} {
  return {
    name: 'tmdb',
    search: vi.fn(async ({ title, kind }) =>
      pool.filter(
        c =>
          c.ref.kind === kind &&
          [c.title, c.originalTitle, ...(c.alternativeTitles ?? [])].some(t =>
            t?.toLowerCase().includes(title.toLowerCase().slice(0, 6))
          )
      )
    ),
    details: vi.fn(
      async (kind, id) =>
        pool.find(c => c.ref.kind === kind && c.ref.id === id) ?? null
    ),
    find: vi.fn(async () => []),
  }
}

const guess = (patch: Partial<AiGuess> = {}): AiGuess => ({
  title: '剧场版 吹响吧！上低音号',
  originalTitle: 'Gekijouban Hibike! Euphonium',
  year: 2016,
  type: 'movie',
  confidence: 0.9,
  ...patch,
})

const TARGET: IdentifyTarget = {
  id: 7,
  libraryId: 1,
  type: 'movie',
  localKey: 'movie:1:gekijouban',
  title: 'Gekijouban Hibike',
  year: 2016,
  matchState: 'unmatched',
  tmdbId: null,
  source: 'tmdb',
}

const FILE_NAME = '[BD]Gekijouban.Hibike.2016.1080p.x265-FRDS.mkv'

/** 假执行器上下文：记录 applyRef / writeUndecided 的调用。 */
function fakeContext(provider: MetadataProvider, fileName = FILE_NAME) {
  const applied: Array<{ id: string; breakdown: Record<string, number> }> = []
  const undecided: Array<{ state: string; ids: string[]; ai: unknown[] }> = []
  const ctx = {
    deps: {
      provider,
      store: {
        files: () => [
          {
            id: 1,
            itemId: 7,
            displayPath: `/Movies/新建文件夹 (3)/${fileName}`,
            dir: 'd:/movies/新建文件夹 (3)',
            name: fileName,
            size: 1,
            parsed: null,
            fingerprint: null,
            duration: null,
          },
        ],
        children: () => [],
        libraryRoot: () => ({ rootKey: 'd:/movies', root: '/Movies' }),
        videoNamesIn: () => [FILE_NAME, 'Sample.mkv'],
      },
    },
    readText: async () => undefined,
    now: () => 0,
    applyRef: vi.fn(async (_t, ref, _s, result: IdentifyResult) => {
      applied.push({
        id: ref.id,
        breakdown: (result.status === 'matched'
          ? result.scored?.breakdown
          : {}) as Record<string, number>,
      })
      return {} as never
    }),
    writeUndecided: vi.fn((_t, candidates, _c, state) => {
      undecided.push({
        state,
        ids: candidates.map(c => c.candidate.ref.id),
        ai: candidates.map(c => c.breakdown.ai),
      })
      return state
    }),
  } as unknown as RunnerContext
  return { ctx, applied, undecided }
}

/** mock 大模型：返回给定推断（JSON 未校验）。 */
function fakeAi(
  data: unknown,
  status = { configured: true, fallback: true }
): LibraryAi & { chatJson: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn(async () => status),
    chatJson: vi.fn(async () => data),
  }
}

// —————————————————————————— 提示词 ——————————————————————————

describe('buildGuessRequest', () => {
  it('带上文件名、目录、同目录文件，并要求结构化输出', () => {
    const request = buildGuessRequest(
      {
        kind: 'movie',
        fileName: FILE_NAME,
        folder: '新建文件夹 (3)',
        siblings: ['Sample.mkv'],
      },
      false
    )
    expect(request.schema).toBe(AI_GUESS_SCHEMA)
    expect(request.schemaName).toBe('media_guess')
    expect(request.temperature).toBe(0)
    expect(request.private).toBeUndefined()
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[0].content).toContain('罗马音')
    const user = request.messages[1].content
    expect(user).toContain('媒体库类型：电影')
    expect(user).toContain(`文件名：${FILE_NAME}`)
    expect(user).toContain('所在文件夹：新建文件夹 (3)')
    expect(user).toContain('- Sample.mkv')
  })

  it('根目录、剧集库、同目录文件截断与私密标记', () => {
    const siblings = Array.from({ length: 30 }, (_, i) => `ep${i}.mkv`)
    const request = buildGuessRequest(
      { kind: 'tv', fileName: 'a.mkv', folder: '', siblings },
      true
    )
    const user = request.messages[1].content
    expect(request.private).toBe(true)
    expect(user).toContain('媒体库类型：剧集')
    expect(user).toContain('（媒体库根目录）')
    expect(user.match(/^- /gm)).toHaveLength(SIBLINGS_MAX)
  })

  it('私密板块：番号库', () => {
    expect(isPrivateSource('jav')).toBe(true)
    expect(isPrivateSource('tmdb')).toBe(false)
  })
})

// —————————————————————————— 输出校验 ——————————————————————————

describe('parseGuess', () => {
  it('合法输出', () => {
    expect(
      parseGuess({
        title: ' 星际穿越 ',
        originalTitle: 'Interstellar',
        year: 2014,
        type: 'movie',
        season: 1,
        episode: 2,
        confidence: 0.95,
      })
    ).toEqual({
      title: '星际穿越',
      originalTitle: 'Interstellar',
      year: 2014,
      type: 'movie',
      confidence: 0.95,
    })
  })

  it('剧集保留季集，原名与标题相同时省略', () => {
    expect(
      parseGuess({
        title: 'Breaking Bad',
        originalTitle: 'Breaking Bad',
        year: null,
        type: 'tv',
        season: 0,
        episode: 3,
        confidence: 2,
      })
    ).toEqual({
      title: 'Breaking Bad',
      type: 'tv',
      season: 0,
      episode: 3,
      confidence: 1,
    })
  })

  it('不合法的输出', () => {
    expect(parseGuess(null)).toBeNull()
    expect(parseGuess([])).toBeNull()
    expect(parseGuess({ title: '', type: 'movie' })).toBeNull()
    expect(parseGuess({ title: 'x', type: 'anime' })).toBeNull()
    expect(
      parseGuess({ title: 'x', type: 'movie', year: 99999, confidence: 'a' })
    ).toEqual({ title: 'x', type: 'movie', confidence: 0 })
    expect(
      parseGuess({ title: 'x', type: 'tv', season: 1.5, episode: -1 })
    ).toEqual({ title: 'x', type: 'tv', confidence: 0 })
  })
})

// —————————————————————————— 线索与缓存键 ——————————————————————————

describe('folderLabel / guessCacheKey', () => {
  it('相对媒体库根的最后两级目录', () => {
    expect(folderLabel('/Movies/a.mkv', '/Movies')).toBe('')
    expect(folderLabel('/Movies/X/a.mkv', '/Movies')).toBe('X')
    expect(folderLabel('D:\\TV\\Show\\Season 1\\e1.mkv', 'D:\\TV')).toBe(
      'Show/Season 1'
    )
    expect(folderLabel('/a/b/c/d.mkv')).toBe('b/c')
  })

  it('同一文件名（大小写不敏感）同一个键，目录或库类型不同则不同', () => {
    const base = {
      kind: 'movie' as const,
      fileName: 'A.mkv',
      folder: 'X',
      siblings: [],
    }
    expect(guessCacheKey(base)).toBe(
      guessCacheKey({ ...base, fileName: 'a.MKV', siblings: ['b.mkv'] })
    )
    expect(guessCacheKey(base)).toMatch(/^ai:guess:movie:[0-9a-f]{40}$/)
    expect(guessCacheKey(base)).not.toBe(
      guessCacheKey({ ...base, folder: 'Y' })
    )
    expect(guessCacheKey(base)).not.toBe(guessCacheKey({ ...base, kind: 'tv' }))
  })
})

describe('guessToInput', () => {
  it('电影：标题 / 原名 / 年份 / 时长', () => {
    expect(guessToInput(guess(), 'movie', { runtimeMinutes: 103 })).toEqual({
      parsed: {
        type: 'movie',
        title: '剧场版 吹响吧！上低音号',
        altTitle: 'Gekijouban Hibike! Euphonium',
        year: 2016,
      },
      runtimeMinutes: 103,
    })
  })

  it('剧集：优先用本地各集汇总，没有时用推断的季集', () => {
    const tv = guess({
      type: 'tv',
      season: 2,
      episode: 5,
      originalTitle: undefined,
    })
    expect(guessToInput(tv, 'tv').episodes).toEqual({
      season: 2,
      episodes: [5],
    })
    expect(
      guessToInput(tv, 'tv', { episodes: { season: 1, episodes: [1, 2] } })
        .episodes
    ).toEqual({ season: 1, episodes: [1, 2] })
  })
})

// —————————————————————————— TMDB 验证 ——————————————————————————

describe('acceptAiMatch（TMDB 验证匹配规则）', () => {
  const run = (g: AiGuess, pool = [HIBIKE, HIBIKE_2017]) =>
    identify(guessToInput(g, 'movie'), { provider: fakeTmdb(pool) })

  it('标题与年份都对上才采用', async () => {
    const g = guess()
    const result = await run(g)
    expect(result.status).toBe('matched')
    expect(acceptAiMatch(g, result, 'movie')).toBe(true)
  })

  it('年份差两年以上不采用', async () => {
    const g = guess()
    const result: IdentifyResult = {
      status: 'matched',
      source: 'search',
      ref: HIBIKE.ref,
      scored: {
        candidate: { ...HIBIKE, year: 2010 },
        score: 0.9,
        breakdown: { title: 1, year: 0 },
      },
    }
    expect(acceptAiMatch(g, result, 'movie')).toBe(false)
  })

  it('类型与媒体库不符、把握不够、标题不像都不采用', async () => {
    const matched: IdentifyResult = {
      status: 'matched',
      source: 'search',
      ref: HIBIKE.ref,
      scored: {
        candidate: HIBIKE,
        score: 0.9,
        breakdown: { title: 0.85, year: 1 },
      },
    }
    expect(acceptAiMatch(guess({ type: 'tv' }), matched, 'movie')).toBe(false)
    expect(acceptAiMatch(guess({ confidence: 0.4 }), matched, 'movie')).toBe(
      false
    )
    expect(acceptAiMatch(guess(), matched, 'movie')).toBe(true)
    // 没有年份时要求标题更像
    expect(acceptAiMatch(guess({ year: undefined }), matched, 'movie')).toBe(
      false
    )
    const low = {
      ...matched,
      scored: { ...matched.scored!, breakdown: { title: 0.7 } },
    }
    expect(acceptAiMatch(guess(), low, 'movie')).toBe(false)
  })

  it('待确认 / 未匹配不采用，候选标上 AI 来源', () => {
    const review: IdentifyResult = {
      status: 'review',
      candidates: [
        { candidate: HIBIKE, score: 0.7, breakdown: { title: 0.7 } },
      ],
    }
    expect(acceptAiMatch(guess(), review, 'movie')).toBe(false)
    const [c] = aiCandidates(review, 0.66)
    expect(c.breakdown.ai).toBe(0.66)
    expect(
      candidateInfo('movie', '1', { title: 't', breakdown: { ai: 0.66 } }, 0.7)
        .source
    ).toBe('ai')
    expect(
      candidateInfo('movie', '1', { title: 't' }, 0.7).source
    ).toBeUndefined()
  })
})

// —————————————————————————— 执行流程（mock 大模型与 TMDB） ——————————————————————————

describe('AiScraper', () => {
  const aiOutput = {
    title: '剧场版 吹响吧！上低音号',
    originalTitle: 'Gekijouban Hibike! Euphonium',
    year: 2016,
    type: 'movie',
    season: null,
    episode: null,
    confidence: 0.92,
  }

  it('兜底：推断 → TMDB 验证通过 → 自动匹配并标记 AI 来源', async () => {
    const ai = fakeAi(aiOutput)
    const { ctx, applied } = fakeContext(fakeTmdb([HIBIKE, HIBIKE_2017]))
    const scraper = new AiScraper({ ai, cache: new MemoryResponseCache() })
    const outcome = await scraper.fallback(
      ctx,
      TARGET,
      'unmatched',
      new ItemChanges()
    )
    expect(outcome).toBe('matched')
    expect(applied).toEqual([
      { id: '378064', breakdown: expect.objectContaining({ ai: 0.92 }) },
    ])
    const request = ai.chatJson.mock.calls[0][0]
    expect(request.messages[1].content).toContain('所在文件夹：新建文件夹 (3)')
    expect(request.messages[1].content).toContain('- Sample.mkv')
    // 同目录文件里不重复列出代表文件本身
    expect(request.messages[1].content.match(/Gekijouban/g)).toHaveLength(1)
  })

  it('按文件名缓存：同一文件第二次不再调用大模型', async () => {
    const ai = fakeAi(aiOutput)
    const cache = new MemoryResponseCache()
    const scraper = new AiScraper({ ai, cache })
    for (let i = 0; i < 2; i++) {
      const { ctx } = fakeContext(fakeTmdb([HIBIKE]))
      await scraper.fallback(ctx, TARGET, 'unmatched', new ItemChanges())
    }
    expect(ai.chatJson).toHaveBeenCalledTimes(1)
    // 新实例（引擎重启）读持久缓存
    const again = fakeAi(aiOutput)
    const { ctx } = fakeContext(fakeTmdb([HIBIKE]))
    await new AiScraper({ ai: again, cache }).fallback(
      ctx,
      TARGET,
      'unmatched',
      new ItemChanges()
    )
    expect(again.chatJson).not.toHaveBeenCalled()
  })

  it('认不出也缓存，不重复花费', async () => {
    const ai = fakeAi({ title: '', type: 'movie', confidence: 0 })
    const scraper = new AiScraper({ ai, cache: new MemoryResponseCache() })
    for (let i = 0; i < 2; i++) {
      const { ctx, applied, undecided } = fakeContext(fakeTmdb([HIBIKE]))
      expect(
        await scraper.fallback(ctx, TARGET, 'unmatched', new ItemChanges())
      ).toBe('unmatched')
      expect(applied).toEqual([])
      expect(undecided).toEqual([])
    }
    expect(ai.chatJson).toHaveBeenCalledTimes(1)
  })

  it('验证没通过：未匹配的条目改为待确认（AI 候选）；已是待确认的保持原样', async () => {
    const ai = fakeAi({ ...aiOutput, year: 2009 })
    const scraper = new AiScraper({ ai, cache: new MemoryResponseCache() })
    const first = fakeContext(fakeTmdb([HIBIKE]))
    expect(
      await scraper.fallback(first.ctx, TARGET, 'unmatched', new ItemChanges())
    ).toBe('review')
    expect(first.undecided).toEqual([
      { state: 'review', ids: ['378064'], ai: [0.92] },
    ])
    expect(first.applied).toEqual([])
    const second = fakeContext(fakeTmdb([HIBIKE]))
    expect(
      await scraper.fallback(second.ctx, TARGET, 'review', new ItemChanges())
    ).toBe('review')
    expect(second.undecided).toEqual([])
  })

  it('开关关闭、AI 未配置、已匹配、番号库时不调用', async () => {
    const off = fakeAi(aiOutput, { configured: true, fallback: false })
    const { ctx } = fakeContext(fakeTmdb([HIBIKE]))
    const changes = new ItemChanges()
    await new AiScraper({ ai: off, cache: new MemoryResponseCache() }).fallback(
      ctx,
      TARGET,
      'unmatched',
      changes
    )
    const unconfigured = fakeAi(aiOutput, { configured: false, fallback: true })
    await new AiScraper({
      ai: unconfigured,
      cache: new MemoryResponseCache(),
    }).fallback(ctx, TARGET, 'review', changes)
    const on = fakeAi(aiOutput)
    const scraper = new AiScraper({ ai: on, cache: new MemoryResponseCache() })
    expect(await scraper.fallback(ctx, TARGET, 'matched', changes)).toBe(
      'matched'
    )
    expect(
      await scraper.fallback(
        ctx,
        { ...TARGET, source: 'jav' },
        'unmatched',
        changes
      )
    ).toBe('unmatched')
    expect(
      await scraper.manual(ctx, { ...TARGET, source: 'jav' }, changes)
    ).toBe('skipped')
    expect(
      await scraper.manual(ctx, { ...TARGET, matchState: 'auto' }, changes)
    ).toBe('skipped')
    expect(off.chatJson).not.toHaveBeenCalled()
    expect(unconfigured.chatJson).not.toHaveBeenCalled()
    expect(on.chatJson).not.toHaveBeenCalled()
  })

  it('手动识别不看开关，错误向上抛；兜底出错只保留常规结果', async () => {
    const ai = fakeAi(aiOutput, { configured: true, fallback: false })
    const { ctx } = fakeContext(fakeTmdb([HIBIKE]))
    const scraper = new AiScraper({ ai, cache: new MemoryResponseCache() })
    expect(await scraper.manual(ctx, TARGET, new ItemChanges())).toBe('matched')

    const broken: LibraryAi = {
      status: async () => ({ configured: true, fallback: true }),
      chatJson: async () => {
        throw new Error('[ai:http] 401')
      },
    }
    const failing = new AiScraper({
      ai: broken,
      cache: new MemoryResponseCache(),
    })
    await expect(
      failing.manual(ctx, TARGET, new ItemChanges())
    ).rejects.toThrow('401')
    expect(
      await failing.fallback(ctx, TARGET, 'unmatched', new ItemChanges())
    ).toBe('unmatched')
  })

  it('连续出错后暂停调用', async () => {
    const chatJson = vi.fn(async () => {
      throw new Error('[ai:network] down')
    })
    let now = 0
    const scraper = new AiScraper({
      ai: {
        status: async () => ({ configured: true, fallback: true }),
        chatJson,
      },
      cache: new MemoryResponseCache(),
      now: () => now,
    })
    for (let i = 0; i < 5; i++) {
      const { ctx } = fakeContext(fakeTmdb([HIBIKE]), `f${i}.mkv`)
      await scraper.fallback(ctx, TARGET, 'unmatched', new ItemChanges())
    }
    expect(chatJson).toHaveBeenCalledTimes(3)
    now += 6 * 60_000
    const { ctx } = fakeContext(fakeTmdb([HIBIKE]))
    await scraper.fallback(ctx, TARGET, 'unmatched', new ItemChanges())
    expect(chatJson).toHaveBeenCalledTimes(4)
  })

  it('手动识别的前置检查', async () => {
    await expect(requireAiConfigured(undefined)).rejects.toThrow('不支持')
    const scraper = new AiScraper({
      ai: fakeAi(aiOutput, { configured: false, fallback: false }),
      cache: new MemoryResponseCache(),
    })
    await expect(requireAiConfigured(scraper)).rejects.toThrow('还没有配置')
  })
})

describe('createLimiter（限速）', () => {
  it('同时最多 n 个任务', async () => {
    const limit = createLimiter(2)
    let running = 0
    let peak = 0
    const task = () =>
      limit(async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise(r => setTimeout(r, 5))
        running--
        return running
      })
    await Promise.all(Array.from({ length: 6 }, task))
    expect(peak).toBe(2)
  })

  it('任务失败不占住名额', async () => {
    const limit = createLimiter(1)
    await expect(
      limit(async () => Promise.reject(new Error('x')))
    ).rejects.toThrow('x')
    await expect(limit(async () => 1)).resolves.toBe(1)
  })
})

// —————————————————————————— 契约与界面规则 ——————————————————————————

describe('契约', () => {
  it('identify 参数带 ai 标记；AI 模式的目标是待确认 / 未匹配', () => {
    expect(parseRpcParams('identify', { itemIds: [1], ai: true })).toEqual({
      libraryId: undefined,
      itemIds: [1],
      force: false,
      ai: true,
    })
    expect(parseRpcParams('identify', { libraryId: 2 })).not.toHaveProperty(
      'ai'
    )
    expect(targetScope('ai')).toBe('undecided')
  })
})

describe('界面规则', () => {
  it('AI 是否配置好、哪些分区 / 条目能用', () => {
    expect(aiScrapeReady('ollama', false)).toBe(true)
    expect(aiScrapeReady('deepseek', false)).toBe(false)
    expect(aiScrapeReady('deepseek', true)).toBe(true)
    expect(sectionSupportsAi('jav')).toBe(false)
    expect(sectionSupportsAi('movie')).toBe(true)
    expect(stateSupportsAi('review')).toBe(true)
    expect(stateSupportsAi('auto')).toBe(false)
  })

  it('任务结束事件与合计', () => {
    const progress = {
      type: 'identify-progress' as const,
      jobId: 3,
      mode: 'identify' as const,
      libraryId: 1,
      total: 4,
      done: 4,
      matched: 2,
      review: 1,
      unmatched: 1,
      failed: 0,
      finished: true,
    }
    expect(terminalOf(progress)).toBe(progress)
    expect(terminalOf({ ...progress, finished: false })).toBeNull()
    const failed = terminalOf({
      type: 'job',
      jobId: 4,
      jobType: 'identify',
      state: 'failed',
      error: '未配置 TMDB API 令牌',
    })
    expect(failed?.error).toBe('未配置 TMDB API 令牌')
    expect(
      terminalOf({ type: 'job', jobId: 4, jobType: 'scan', state: 'failed' })
    ).toBeNull()
    const total = sumProgress([
      progress,
      { ...progress, matched: 1, failed: 2 },
    ])
    expect(total).toEqual({ matched: 3, review: 2, unmatched: 2, failed: 2 })
    expect(aiDoneText(total)).toBe(
      'AI 识别完成：匹配 3，待确认 2，仍未识别 2，失败 2'
    )
    expect(aiDoneText(sumProgress([progress, failed!]))).toContain(
      'AI 识别中断'
    )
  })
})

// —————————————————————————— 引擎集成（真实识别链 + 假 TMDB + mock 大模型） ——————————————————————————

describe('引擎集成', () => {
  const PARASITE = {
    title: '寄生虫',
    originalTitle: '기생충',
    year: 2019,
    type: 'movie',
    season: null,
    episode: null,
    confidence: 0.9,
  }

  async function engine(status: { configured: boolean; fallback: boolean }) {
    const tree = tempTree()
    tree.write('Gisaengchung.2019.1080p.mkv', '')
    const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
    const ai = fakeAi(PARASITE, status)
    const service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      identify: {
        fetch: tmdb.fetch,
        env: { tmdbToken: FAKE_TOKEN },
        probeDuration: async () => undefined,
        ai,
      },
    })
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    await service.queue.idle()
    const item = () =>
      service.db
        .prepare(
          'SELECT id, tmdb_id, match_state FROM media_items WHERE parent_id IS NULL'
        )
        .get() as { id: number; tmdb_id: string | null; match_state: string }
    return { tree, service, ai, item }
  }

  it('开关打开：常规识别失败后自动用 AI 推断并经 TMDB 验证采用', async () => {
    const env = await engine({ configured: true, fallback: true })
    try {
      expect(env.item()).toMatchObject({
        tmdb_id: '496243',
        match_state: 'auto',
      })
      expect(
        env.service.getMatchCandidates({ itemId: Number(env.item().id) })
          .current?.source
      ).toBe('ai')
      expect(env.ai.chatJson.mock.calls[0][0].messages[1].content).toContain(
        'Gisaengchung.2019.1080p.mkv'
      )
    } finally {
      await env.service.close()
      env.tree.cleanup()
    }
  })

  it('开关关闭：保持未匹配；手动 AI 识别后匹配', async () => {
    const env = await engine({ configured: true, fallback: false })
    try {
      expect(env.item().match_state).toBe('unmatched')
      expect(env.ai.chatJson).not.toHaveBeenCalled()
      await env.service.identifier.aiIdentify({
        itemIds: [Number(env.item().id)],
      })
      await env.service.queue.idle()
      expect(env.item()).toMatchObject({
        tmdb_id: '496243',
        match_state: 'auto',
      })
      expect(env.ai.chatJson).toHaveBeenCalledTimes(1)
    } finally {
      await env.service.close()
      env.tree.cleanup()
    }
  })
})
