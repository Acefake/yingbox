import { basename, dirname, normalize } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AiSubtitleCue } from '../src/shared/ai-subtitles/types'
import { parseSaveOptions } from '../src/shared/contract/recap'
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
  createRecapCache,
  parseCacheFile,
  pruneEntries,
} from '../src/main/recap/cache'
import {
  type SourceDeps,
  findTvshowTmdbId,
  listEpisodes,
  locateMaterial,
  standaloneFile,
} from '../src/main/recap/sources'

/**
 * 前情提要 / 问剧情：token 预算与分段、缓存键、同目录认集、素材优先级、摘要缓存文件。
 * 摘要器、提示词与 IPC 校验见 recap-summarize.test.ts，播放器状态见 recap-player.test.ts。
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
      expect(closed.chunks).toEqual(whole.slice(0, closed.chunks.length))
      expect(closed.covered).toBe(closed.chunks.flat().length)
      expect(closed.covered).toBeLessThan(cut)
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

  it('之前几集：同目录两部剧只挑同一部（剧名忽略大小写与空白）', () => {
    const files = [
      '/tv/合集/[组] Alpha Show - 01.mkv',
      '/tv/合集/[组] Alpha Show - 02.mkv',
      '/tv/合集/[组] Beta - 01.mkv',
      '/tv/合集/[组] Beta - 02.mkv',
      '/tv/合集/[组] beta - 03.mkv',
    ]
      .map(path => episodeOf(path))
      .filter(f => f !== null)
    expect(files).toHaveLength(5)
    const current = files[4]
    const picked = previousEpisodes(current, files, 3)
    expect(picked.map(f => f.path)).toEqual([
      '/tv/合集/[组] Beta - 01.mkv',
      '/tv/合集/[组] Beta - 02.mkv',
    ])
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

  it('外挂 srt：forced 轨不用（只有外语对白）', () => {
    const video = `${dir}/漫长的季节 S01E01.mkv`
    expect(pickSidecarSrt(video, ['漫长的季节 S01E01.forced.srt'])).toBeNull()
    expect(
      pickSidecarSrt(video, [
        '漫长的季节 S01E01.zh.forced.srt',
        '漫长的季节 S01E01.en.srt',
      ])
    ).toBe('漫长的季节 S01E01.en.srt')
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
  files = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [normalize(path), text])
  )
  return {
    readdir: async dir =>
      Object.keys(files)
        .filter(p => dirname(p) === normalize(dir))
        .map(p => basename(p)),
    stat: async path =>
      normalize(path) in files ? { mtimeMs: 1, size: 1 } : null,
    readText: async path => {
      if (!(normalize(path) in files)) throw new Error('ENOENT')
      return files[normalize(path)]
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
    expect(write).not.toHaveBeenCalled()
    await cache.flush()
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
