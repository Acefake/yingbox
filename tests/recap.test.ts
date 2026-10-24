import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AiSubtitleCue } from '../src/shared/ai-subtitles/types'
import type { AiMessage } from '../src/shared/ai/types'
import {
  parsePrepareOptions,
  parseProbeOptions,
  parseSaveOptions,
} from '../src/shared/contract/recap'
import {
  CHUNK_TOKENS,
  chunkKey,
  chunkLines,
  closedChunks,
  cueLines,
  episodeKey,
  estimateTokens,
  recapKey,
  tailLines,
  truncateToTokens,
} from '../src/shared/recap/budget'
import {
  episodeOf,
  nfoPlot,
  pickSidecarSrt,
  previousEpisodes,
  tvshowTmdbId,
} from '../src/shared/recap/episodes'
import {
  formatClock,
  qaMessages,
  recapMessages,
  scopeText,
} from '../src/shared/recap/prompts'
import type { RecapContext } from '../src/shared/recap/types'
import {
  type RecapCache,
  createRecapCache,
  parseCacheFile,
  pruneEntries,
} from '../src/main/recap/cache'
import {
  type LocatedMaterial,
  type SourceDeps,
  findTvshowTmdbId,
  listEpisodes,
  locateMaterial,
  standaloneFile,
} from '../src/main/recap/sources'
import { createSummarizer } from '../src/main/recap/summarize'
import {
  recapErrorText,
  shouldOfferRecap,
  stripIpcPrefix,
} from '../src/renderer/src/features/player/recap/recap-rules'

/**
 * 前情提要 / 问剧情：token 预算与分段、缓存键、同目录认集、素材优先级、提示词（不剧透）、
 * 摘要缓存与复用（AI 全部 mock）、提示卡规则。
 * test-affected: repo-wide（最后一组读源码断言接入方式）
 */

const cue = (sec: number, text: string): AiSubtitleCue => ({
  start: sec * 1000,
  end: sec * 1000 + 900,
  text,
})

describe('token 预算与分段', () => {
  it('中文按字、其余按 4 个字符一组估算', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('你好 ab')).toBe(3)
  })

  it('超出预算时从头截断并加省略号', () => {
    expect(truncateToTokens('短句', 10)).toBe('短句')
    expect(truncateToTokens('一二三四五六', 3)).toBe('一二三…')
  })

  it('台词行：去标签、双语只留中文、去连续重复', () => {
    const lines = cueLines(
      [
        cue(1, '{\\an8}<i>你好</i>\nHello'),
        cue(2, '你好\nHello'),
        cue(3, '再见\nBye'),
      ],
      true
    )
    expect(lines).toEqual(['你好', '再见'])
    expect(cueLines([cue(1, 'Line one\nline two')])).toEqual([
      'Line one line two',
    ])
  })

  it('按预算贪心分段，每段不超预算', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `第${i}句台词内容很长`)
    const chunks = chunkLines(lines, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks)
      expect(
        chunk.reduce((sum, line) => sum + estimateTokens(line) + 1, 0)
      ).toBeLessThanOrEqual(60)
    expect(chunks.flat()).toEqual(lines)
  })

  it('截到任意进度，已封口的段与整集分段逐字相同（缓存可复用）', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `台词${i}`.repeat(3))
    const whole = chunkLines(lines, 100)
    for (const cut of [10, 57, 120, 199]) {
      const closed = closedChunks(lines.slice(0, cut), 100)
      expect(closed).toEqual(whole.slice(0, closed.length))
    }
  })

  it('最近台词从末尾往前取，保持顺序', () => {
    expect(tailLines(['一一', '二二', '三三'], 6)).toEqual(['二二', '三三'])
  })

  it('默认段大小控制在几千 tokens', () => {
    expect(CHUNK_TOKENS).toBeGreaterThanOrEqual(1000)
    expect(CHUNK_TOKENS).toBeLessThanOrEqual(8000)
  })
})

describe('缓存键', () => {
  const identity = {
    videoPath: '/tv/a/S01E01.mkv',
    kind: 'subtitle' as const,
    sourcePath: '/tv/a/S01E01.zh.srt',
    mtimeMs: 1000,
    size: 10,
  }

  it('素材修改时间或路径变了，整集摘要键就变', () => {
    const base = episodeKey(identity)
    expect(base).toMatch(/^ep:[\da-f]{16}$/)
    expect(episodeKey({ ...identity })).toBe(base)
    expect(episodeKey({ ...identity, mtimeMs: 2000 })).not.toBe(base)
    expect(episodeKey({ ...identity, sourcePath: '/x.srt' })).not.toBe(base)
    expect(chunkKey(base, 2)).toBe(`${base}:c2`)
  })

  it('前情提要键与之前各集的键及顺序相关，格式符合契约校验', () => {
    const a = recapKey('/v.mkv', ['ep:1', 'ep:2'])
    expect(a).toMatch(/^recap:[\da-f]{16}$/)
    expect(recapKey('/v.mkv', ['ep:2', 'ep:1'])).not.toBe(a)
    expect(parseSaveOptions({ cacheKey: a, text: ' 要点 ' })).toEqual({
      cacheKey: a,
      text: '要点',
    })
  })
})

describe('同目录认集与素材选择', () => {
  const dir = '/tv/漫长的季节/Season 1'
  const ep = (n: number, suffix = ''): string =>
    `${dir}/漫长的季节 S01E${String(n).padStart(2, '0')}${suffix}.mkv`

  it('认出季 / 集，特别篇与电影不算', () => {
    expect(episodeOf(ep(3))).toMatchObject({
      season: 1,
      episode: 3,
      label: 'S01E03',
      show: '漫长的季节',
    })
    expect(episodeOf('/tv/狂飙/狂飙 第12集.mp4')).toMatchObject({
      episode: 12,
      label: '第 12 集',
    })
    expect(episodeOf('/movies/Inception (2010)/Inception.mkv')).toBeNull()
    expect(episodeOf(`${dir}/漫长的季节 S00E01.mkv`)).toBeNull()
    expect(episodeOf(`${dir}/漫长的季节 S01E01.srt`)).toBeNull()
  })

  it('之前几集：同季、离当前最近、最多 N 集，旧 → 新；同集多版本只取一个', () => {
    const files = [1, 2, 3, 4, 5, 6]
      .map(n => episodeOf(ep(n)))
      .concat(episodeOf(ep(4, '.1080p')))
      .filter(f => f !== null)
    const current = episodeOf(ep(5))!
    const picked = previousEpisodes(current, files, 3)
    expect(picked.map(f => f.episode)).toEqual([2, 3, 4])
    expect(previousEpisodes(episodeOf(ep(1))!, files, 3)).toEqual([])
    const otherSeason = episodeOf('/tv/x/Show S02E01.mkv')!
    expect(previousEpisodes(otherSeason, files, 3)).toEqual([])
  })

  it('外挂 srt：中文优先，其次英文，其次同名；其他语言不用', () => {
    const video = `${dir}/漫长的季节 S01E01.mkv`
    const names = [
      '漫长的季节 S01E01.srt',
      '漫长的季节 S01E01.en.srt',
      '漫长的季节 S01E01.chs.srt',
      '漫长的季节 S01E01.ja.srt',
      '漫长的季节 S01E02.zh.srt',
    ]
    expect(pickSidecarSrt(video, names)).toBe('漫长的季节 S01E01.chs.srt')
    expect(
      pickSidecarSrt(
        video,
        names.filter(n => !n.includes('chs'))
      )
    ).toBe('漫长的季节 S01E01.en.srt')
    expect(pickSidecarSrt(video, ['漫长的季节 S01E01.ja.srt'])).toBeNull()
    expect(pickSidecarSrt(video, ['漫长的季节 S01E01.ass'])).toBeNull()
  })

  it('NFO：读 <plot>（CDATA、实体），tvshow.nfo 读 TMDB id', () => {
    expect(
      nfoPlot(
        '<episodedetails><plot><![CDATA[王响 &amp; 龚彪\n  夜车]]></plot></episodedetails>'
      )
    ).toBe('王响 & 龚彪 夜车')
    expect(nfoPlot('<plot>  </plot>')).toBeNull()
    expect(
      tvshowTmdbId('<tvshow><uniqueid type="tmdb">12345</uniqueid></tvshow>')
    ).toBe('12345')
    expect(
      tvshowTmdbId('<movie><uniqueid type="tmdb">1</uniqueid></movie>')
    ).toBeNull()
  })
})

/** 假文件系统：路径 → 内容 / 修改时间 */
function fakeDeps(
  files: Record<string, string>,
  extra: Partial<SourceDeps> = {}
): SourceDeps {
  return {
    readdir: async dir =>
      Object.keys(files)
        .filter(p => p.slice(0, p.lastIndexOf('/')) === dir)
        .map(p => p.slice(p.lastIndexOf('/') + 1)),
    stat: async path => (path in files ? { mtimeMs: 1, size: 1 } : null),
    readText: async path => {
      if (!(path in files)) throw new Error('ENOENT')
      return files[path]
    },
    aiSubtitle: async () => null,
    ...extra,
  }
}

const SRT =
  '1\n00:00:01,000 --> 00:00:02,000\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\n再见\n'

describe('素材定位优先级', () => {
  const dir = '/tv/show/Season 1'
  const video = `${dir}/Show S01E02.mkv`
  const file = episodeOf(video)!
  const noNet = { allowNetwork: false, tmdbId: async () => null }

  it('AI 字幕优先于外挂 srt，双语 AI 字幕标记 bilingual', async () => {
    const deps = fakeDeps(
      {
        [video]: '',
        [`${dir}/Show S01E02.zh.srt`]: SRT,
        '/cache/ai.srt': SRT,
      },
      { aiSubtitle: async () => ({ path: '/cache/ai.srt', mode: 'bilingual' }) }
    )
    const names = await deps.readdir(dir)
    const found = await locateMaterial(file, names, deps, noNet)
    expect(found?.identity.sourcePath).toBe('/cache/ai.srt')
    expect(await found?.read()).toMatchObject({
      kind: 'subtitle',
      bilingual: true,
    })
  })

  it('没有字幕用同名 NFO 的分集简介；都没有且不许联网时返回 null', async () => {
    const deps = fakeDeps({
      [video]: '',
      [`${dir}/Show S01E02.nfo`]:
        '<episodedetails><plot>简介</plot></episodedetails>',
    })
    const found = await locateMaterial(
      file,
      await deps.readdir(dir),
      deps,
      noNet
    )
    expect(found?.identity.kind).toBe('overview')
    expect(await found?.read()).toEqual({ kind: 'overview', text: '简介' })
    expect(await locateMaterial(file, [], fakeDeps({}), noNet)).toBeNull()
  })

  it('本地都没有时联网查 TMDB（私密不联网）', async () => {
    const tmdbOverview = vi.fn(async () => 'TMDB 简介')
    const deps = fakeDeps(
      {
        [`/tv/show/tvshow.nfo`]:
          '<tvshow><uniqueid type="tmdb">99</uniqueid></tvshow>',
      },
      { tmdbOverview }
    )
    const tmdbId = (): Promise<string | null> => findTvshowTmdbId(video, deps)
    expect(await tmdbId()).toBe('99')
    const found = await locateMaterial(file, [], deps, {
      allowNetwork: true,
      tmdbId,
    })
    expect(found?.identity.sourcePath).toBe('tmdb:99:1:2')
    expect(await found?.read()).toEqual({ kind: 'overview', text: 'TMDB 简介' })
    expect(tmdbOverview).toHaveBeenCalledWith('99', 1, 2)
    expect(
      await locateMaterial(file, [], deps, { allowNetwork: false, tmdbId })
    ).toBeNull()
  })

  it('同目录列集；电影当作「本片」', async () => {
    const deps = fakeDeps({
      [`${dir}/Show S01E01.mkv`]: '',
      [video]: '',
      [`${dir}/Show S01E01.srt`]: SRT,
    })
    const listing = await listEpisodes(video, deps)
    expect(listing.current?.episode).toBe(2)
    expect(listing.siblings.map(f => f.episode).sort()).toEqual([1, 2])
    const movie = await listEpisodes('/m/Inception (2010)/Inception.mkv', deps)
    expect(movie.current).toBeNull()
    expect(standaloneFile('/m/Inception (2010)/Inception.mkv')).toMatchObject({
      label: '本片',
      show: 'Inception',
    })
  })
})

describe('摘要缓存', () => {
  it('解析容错、按最早写入淘汰', () => {
    expect(parseCacheFile('坏的')).toEqual(new Map())
    const entries = new Map([
      ['a', { text: 'A', at: 1 }],
      ['b', { text: 'B', at: 3 }],
      ['c', { text: 'C', at: 2 }],
    ])
    expect([...pruneEntries(entries, 2).keys()].sort()).toEqual(['b', 'c'])
  })

  it('普通内容落盘，私密内容只放内存', async () => {
    const write = vi.fn(async (_text: string) => {})
    const cache = createRecapCache({ read: async () => null, write })
    await cache.set('k1', '普通', true)
    await cache.set('k2', '私密', false)
    expect(await cache.get('k1')).toBe('普通')
    expect(await cache.get('k2')).toBe('私密')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('普通')
    expect(write.mock.calls[0][0]).not.toContain('私密')
    const reloaded = createRecapCache({
      read: async () => write.mock.calls[0][0],
      write,
    })
    expect(await reloaded.get('k1')).toBe('普通')
    expect(await reloaded.get('k2')).toBeUndefined()
  })
})

describe('摘要器（mock AI）', () => {
  const memoryCache = (): RecapCache =>
    createRecapCache({ read: async () => null, write: async () => {} })

  const located = (
    cues: AiSubtitleCue[],
    key = 'ep:test'
  ): LocatedMaterial => ({
    file: {
      path: '/v/S01E01.mkv',
      show: 'Show',
      season: 1,
      episode: 1,
      label: 'S01E01',
    },
    identity: {
      videoPath: '/v/S01E01.mkv',
      kind: 'subtitle' as const,
      sourcePath: '/v/a.srt',
    },
    key,
    read: vi.fn(async () => ({
      kind: 'subtitle' as const,
      cues,
      bilingual: false,
    })),
  })

  const longCues = Array.from({ length: 600 }, (_, i) =>
    cue(i * 5, `这是第${i}句比较长的台词，用来撑满分段预算`)
  )

  it('短台词一次摘要；长台词分段摘要再合并；第二次全走缓存', async () => {
    const chat = vi.fn(async (messages: AiMessage[]) =>
      messages[0].content.includes('合并') ? '整集摘要' : '段落摘要'
    )
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const short = await summarizer.episode(
      'Show',
      located([cue(1, '你好')], 'ep:s'),
      {
        private: false,
      }
    )
    expect(short).toMatchObject({
      text: '段落摘要',
      source: 'subtitle',
      label: 'S01E01',
    })
    expect(chat).toHaveBeenCalledTimes(1)

    chat.mockClear()
    const material = located(longCues, 'ep:l')
    const chunks = chunkLines(cueLines(longCues)).length
    expect(chunks).toBeGreaterThan(1)
    const long = await summarizer.episode('Show', material, { private: false })
    expect(long?.text).toBe('整集摘要')
    expect(chat).toHaveBeenCalledTimes(chunks + 1)
    for (const [messages] of chat.mock.calls)
      expect(messages.map(m => m.content).join('').length).toBeLessThan(
        CHUNK_TOKENS * 2 + 2000
      )

    chat.mockClear()
    await summarizer.episode('Show', material, { private: false })
    expect(chat).not.toHaveBeenCalled()
  })

  it('本集已播部分：复用整集分段缓存，最近台词不超过进度', async () => {
    const chat = vi.fn(async () => '段落摘要')
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const material = located(longCues, 'ep:cur')
    const part = await summarizer.current('Show', material, 2000, {
      private: false,
    })
    expect(part.hasSubtitle).toBe(true)
    expect(part.summaries.length).toBeGreaterThan(0)
    expect(part.recent).toContain('第399句')
    expect(part.recent).not.toContain('第400句')
    const calls = chat.mock.calls.length
    await summarizer.episode('Show', material, { private: false })
    // 整集摘要只需补算剩下的段 + 合并
    const total = chunkLines(cueLines(longCues)).length
    expect(chat.mock.calls.length - calls).toBe(
      total - part.summaries.length + 1
    )
  })

  it('分集简介不调模型；本集只有简介时不给（防剧透）', async () => {
    const chat = vi.fn(async () => 'x')
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const overview = {
      ...located([]),
      identity: {
        videoPath: '/v',
        kind: 'overview' as const,
        sourcePath: '/v.nfo',
      },
      read: async () => ({ kind: 'overview' as const, text: '分集简介' }),
    }
    expect(
      await summarizer.episode('Show', overview, { private: false })
    ).toMatchObject({ text: '分集简介', source: 'overview' })
    expect(
      await summarizer.current('Show', overview, 100, { private: false })
    ).toEqual({ seconds: 100, summaries: [], recent: '', hasSubtitle: false })
    expect(chat).not.toHaveBeenCalled()
  })

  it('私密：模型调用带 private，缓存不落盘', async () => {
    const chat = vi.fn(
      async (_m: AiMessage[], _o: { private: boolean }) => '摘要'
    )
    const write = vi.fn(async () => {})
    const summarizer = createSummarizer({
      chat,
      cache: createRecapCache({ read: async () => null, write }),
    })
    await summarizer.episode('Show', located([cue(1, '你好')], 'ep:p'), {
      private: true,
    })
    expect(chat.mock.calls[0][1].private).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('提示词', () => {
  const context: RecapContext = {
    show: '漫长的季节',
    episode: { label: 'S01E09', season: 1, episode: 9 },
    previous: [
      {
        label: 'S01E07',
        episode: 7,
        season: 1,
        text: '王响发现卷宗',
        source: 'subtitle',
      },
      {
        label: 'S01E08',
        episode: 8,
        season: 1,
        text: '龚彪跑夜车',
        source: 'overview',
      },
    ],
    cacheKey: 'recap:0000000000000000',
  }

  it('前情提要：150–250 字要点，带上之前各集摘要，不透露之后剧情', () => {
    const [system, user] = recapMessages(context)
    expect(system.content).toContain('150–250')
    expect(system.content).toContain('不要推测或透露之后的剧情')
    expect(user.content).toContain('《漫长的季节》')
    expect(user.content).toContain('【S01E07】王响发现卷宗')
    expect(user.content).toContain('【S01E08（分集简介）】')
  })

  it('问剧情：系统提示带进度与不剧透 / 不确定就说不知道，历史有上限', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `第${i}条`,
    }))
    const messages = qaMessages({
      context: {
        ...context,
        current: {
          seconds: 1930,
          summaries: ['开头'],
          recent: '最近台词',
          hasSubtitle: true,
        },
      },
      question: ' 他是谁？ ',
      history,
    })
    const system = messages[0].content
    expect(system).toContain('32:10')
    expect(system).toContain('绝不能透露')
    expect(system).toContain('我不确定')
    expect(system).toContain('最近台词')
    expect(system).toContain('【第 1 段】开头')
    expect(messages.at(-1)).toEqual({ role: 'user', content: '他是谁？' })
    expect(messages.length).toBe(1 + 6 + 1)
  })

  it('时间与范围文案', () => {
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(scopeText(context.episode)).toBe('S01E09 之前')
    expect(scopeText(null, 30)).toBe('本片 · 0:30 之前')
  })
})

describe('IPC 参数校验', () => {
  it('prepare：用途必填，问剧情要非负进度', () => {
    expect(parsePrepareOptions({ purpose: 'recap', private: true })).toEqual({
      purpose: 'recap',
      private: true,
    })
    expect(parsePrepareOptions({ purpose: 'qa', seconds: 12.5 })).toEqual({
      purpose: 'qa',
      seconds: 12.5,
    })
    expect(() => parsePrepareOptions({ purpose: 'qa' })).toThrow()
    expect(() => parsePrepareOptions({ purpose: 'x' })).toThrow()
    expect(parseProbeOptions(undefined)).toEqual({})
    expect(() => parseSaveOptions({ cacheKey: 'ep:1', text: 'x' })).toThrow()
  })
})

describe('提示卡规则', () => {
  const probe = {
    show: 'S',
    episode: { label: 'S01E02', episode: 2, season: 1 },
    previous: [{ label: 'S01E01', episode: 1, season: 1 }],
    cacheKey: 'recap:0000000000000000',
    cached: null,
  }

  it('第 2 集起、从头播、设置打开、之前有素材才提示', () => {
    expect(shouldOfferRecap({ enabled: true, probe, startAt: 0 })).toBe(true)
    expect(shouldOfferRecap({ enabled: false, probe, startAt: 0 })).toBe(false)
    expect(shouldOfferRecap({ enabled: true, probe, startAt: 300 })).toBe(false)
    expect(
      shouldOfferRecap({
        enabled: true,
        probe: { ...probe, previous: [] },
        startAt: 0,
      })
    ).toBe(false)
    expect(
      shouldOfferRecap({
        enabled: true,
        probe: { ...probe, episode: null },
        startAt: 0,
      })
    ).toBe(false)
  })

  it('错误文案：未配置 / 私密 / 去掉 IPC 外壳', () => {
    expect(recapErrorText({ code: 'not_configured', message: '' })).toContain(
      '设置 → AI'
    )
    expect(recapErrorText({ code: 'private_blocked', message: '' })).toContain(
      '本地'
    )
    expect(
      stripIpcPrefix(
        "Error invoking remote method 'recap:prepare': Error: 前情提要只支持本地视频文件"
      )
    ).toBe('前情提要只支持本地视频文件')
  })
})

describe('接入方式（源码断言）', () => {
  const read = (path: string): string =>
    readFileSync(join(__dirname, '..', path), 'utf8')

  it('PlayerSession 不引用前情提要；UnifiedVideoPlayer 只放一个 RecapLayer 并传私密标记', () => {
    expect(
      read('src/renderer/src/features/player/components/PlayerSession.vue')
    ).not.toMatch(/recap/i)
    const player = read(
      'src/renderer/src/features/player/components/UnifiedVideoPlayer.vue'
    )
    expect(player).toContain('<RecapLayer')
    expect(player).toContain(':private="aiPrivate"')
  })

  it('请求都带私密标记；菜单入口叫「问剧情」「前情提要」', () => {
    const base = 'src/renderer/src/features/player/recap/'
    for (const file of ['use-recap.ts', 'use-plot-qa.ts'])
      expect(read(base + file)).toContain('private: true')
    const layer = read(`${base}RecapLayer.vue`)
    expect(layer).toContain("label: '问剧情'")
    expect(layer).toContain("label: '前情提要'")
  })
})
