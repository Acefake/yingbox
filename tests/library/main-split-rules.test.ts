import { describe, expect, it } from 'vitest'
import { ItemChanges } from '../../src/main/library/catalog/catalog-store'
import {
  PRIORITY as SERVICE_PRIORITY,
  chunks,
  itemsChangedEvent,
  scanJobKey,
} from '../../src/main/library/engine/service-rules'
import {
  identifyJobKey,
  itemsChangedEvents,
  progressEvent,
  refreshCacheKeys,
  scoredInfo,
  takeFreshChanges,
  targetScope,
  toLibraryError,
} from '../../src/main/library/identify/identify-rules'
import {
  matchProviderId,
  storedCandidate,
  toChild,
  toMatch,
  toTarget,
  toTargetFile,
} from '../../src/main/library/identify/identify-rows'
import type { TargetFile } from '../../src/main/library/identify/identify-store'
import {
  type GroupResult,
  groupMovieFiles,
  manualParsed,
  mergeMatchedByRef,
  pickUndecided,
  reusableRef,
  seriesFolder,
  seriesTitles,
  stem,
  workerCount,
} from '../../src/main/library/identify/runner-rules'
import type { RunSummary } from '../../src/main/library/identify/runner-types'
import { ProviderAuthError } from '../../src/main/library/providers/http/provider-http'
import {
  CAST_LIMIT,
  castOf,
  certificationOf,
  crewOf,
} from '../../src/main/library/providers/tmdb/tmdb-credits'
import { toImages } from '../../src/main/library/providers/tmdb/tmdb-images'
import {
  nonEmpty,
  pickTranslation,
  yearOf,
} from '../../src/main/library/providers/tmdb/tmdb-text'
import type { TmdbDetails } from '../../src/main/library/providers/tmdb/tmdb-text'
import type { PlannedMove } from '../../src/main/library/writer/organize/organize-planner'
import {
  blockWithConflictingVideo,
  sidecarOwner,
  withPart,
} from '../../src/main/library/writer/organize/organize-targets'
import {
  canUndo,
  expiredPlans,
  itemsUpdatedEvents,
  mergeWritePayload,
  organizeFinalState,
  organizeOps,
  organizeProgress,
  throttled,
  undoFinalState,
} from '../../src/main/library/writer/writer-rules'
import { ITEMS_CHANGED_LIMIT, LibraryError } from '../../src/shared/library/ipc'
import type {
  ParsedEpisode,
  ParsedMedia,
} from '../../src/shared/library/parser'
import type { ScoredCandidate } from '../../src/shared/library/scoring'

const file = (
  id: number,
  dir: string,
  parsed: ParsedMedia | null,
  name = `f${id}.mkv`
): TargetFile => ({
  id,
  displayPath: `${dir}/${name}`,
  dir,
  name,
  size: 1,
  parsed,
  fingerprint: null,
  duration: null,
})
const movie = (title: string, year?: number): ParsedMedia => ({
  type: 'movie',
  title,
  year,
})
const ep = (
  title: string,
  extra: Partial<ParsedEpisode> = {}
): ParsedEpisode => ({
  type: 'episode',
  title,
  episodes: [1],
  ...extra,
})
const scored = (id: string, score = 0.5): ScoredCandidate => ({
  candidate: {
    ref: { provider: 'tmdb', kind: 'movie', id },
    title: `T${id}`,
  },
  score,
  breakdown: { title: 0.81234, note: 'x' } as never,
})
const matched = (id: string): GroupResult['result'] => ({
  status: 'matched',
  source: 'search' as never,
  ref: { provider: 'tmdb', kind: 'movie', id },
})
const changes = (added: number[], updated: number[] = []): ItemChanges => {
  const c = new ItemChanges()
  for (const id of added) c.added.add(id)
  for (const id of updated) c.updated.add(id)
  return c
}

describe('识别执行器规则', () => {
  it('电影文件按 目录 + 解析结果 分组，跳过未解析与花絮，保持顺序', () => {
    const groups = groupMovieFiles([
      file(1, '/a', movie('X')),
      file(2, '/b', movie('X')),
      file(3, '/a', movie('X')),
      file(4, '/a', null),
      file(5, '/a', { type: 'extra', title: 'X' } as ParsedMedia),
      file(6, '/a', movie('X', 2001)),
    ])
    expect(groups.map(g => g.map(f => f.id))).toEqual([[1, 3], [2], [6]])
  })

  it('匹配结果按条目归并，文件多的排前；没匹配的不进来', () => {
    const merged = mergeMatchedByRef([
      { files: [file(1, '/a', null)], result: matched('9') },
      { files: [file(2, '/b', null)], result: matched('7') },
      { files: [file(3, '/c', null)], result: matched('7') },
      {
        files: [file(4, '/d', null)],
        result: { status: 'review', candidates: [] },
      },
    ])
    expect(merged.map(m => [m.ref.id, m.files.map(f => f.id)])).toEqual([
      ['7', [2, 3]],
      ['9', [1]],
    ])
  })

  it('文件数相同时保持首次匹配的顺序', () => {
    const merged = mergeMatchedByRef([
      { files: [file(1, '/a', null)], result: matched('1') },
      { files: [file(2, '/b', null)], result: matched('2') },
    ])
    expect(merged.map(m => m.ref.id)).toEqual(['1', '2'])
  })

  it('都没匹配上：优先待确认，否则第一组；skipped 没有候选', () => {
    const c = [scored('1')]
    expect(
      pickUndecided([
        { files: [], result: { status: 'unmatched', candidates: [] } },
        { files: [], result: { status: 'review', candidates: c } },
      ])
    ).toEqual({ state: 'review', candidates: c })
    expect(
      pickUndecided([
        { files: [], result: { status: 'unmatched', candidates: c } },
      ])
    ).toEqual({ state: 'unmatched', candidates: c })
    expect(
      pickUndecided([
        { files: [], result: { status: 'skipped', reason: 'extra' } },
      ])
    ).toEqual({ state: 'unmatched', candidates: [] })
  })

  it('剧集文件夹只认 series:<库>:d:<文件夹>', () => {
    expect(seriesFolder('series:3:d:Show (2020)')).toBe('Show (2020)')
    expect(seriesFolder('series:3:t:show')).toBeUndefined()
    expect(seriesFolder('movie:3:d:x')).toBeUndefined()
  })

  it('剧名取出现最多的写法，次多两种和文件夹名进 extraTitles；年份 / ID 用文件夹兜底', () => {
    const r = seriesTitles(
      [ep('B'), ep('A'), ep('A'), ep('C'), ep('D'), ep('D'), ep('D')],
      {
        type: 'movie',
        title: 'Folder',
        altTitle: 'Alt',
        year: 2020,
        ids: { tmdb: '5' },
      }
    )!
    expect(r.parsed.title).toBe('D')
    expect(r.parsed.year).toBe(2020)
    expect(r.parsed.ids).toEqual({ tmdb: '5' })
    expect(r.extraTitles).toEqual(['Folder', 'Alt', 'A', 'B'])
  })

  it('文件名自带年份时不被文件夹覆盖；同票数取先出现的', () => {
    const r = seriesTitles([ep('X', { year: 1999 }), ep('Y')], {
      type: 'movie',
      title: 'F',
      year: 2020,
    })!
    expect(r.parsed.title).toBe('X')
    expect(r.parsed.year).toBe(1999)
  })

  it('没有可用的集时退回文件夹；文件夹也没有 / 是花絮时返回 null', () => {
    const r = seriesTitles([ep('')], { type: 'movie', title: 'F', year: 2001 })!
    expect(r.parsed).toEqual({
      type: 'episode',
      title: 'F',
      altTitle: undefined,
      year: 2001,
      ids: undefined,
      episodes: [],
    })
    expect(seriesTitles([], undefined)).toBeNull()
    expect(
      seriesTitles([], { type: 'extra', title: 'F' } as ParsedMedia)
    ).toBeNull()
  })

  it('沿用已有匹配：刷新 / 锁定 / 识别模式下已自动匹配；其余重新识别', () => {
    const t = {
      tmdbId: '42',
      matchState: 'auto' as const,
      type: 'movie' as const,
    }
    expect(reusableRef(t, 'identify')).toEqual({
      ref: { provider: 'tmdb', kind: 'movie', id: '42' },
      state: 'auto',
    })
    expect(reusableRef(t, 'force')).toBeNull()
    expect(reusableRef({ ...t, matchState: 'review' }, 'identify')).toBeNull()
    expect(reusableRef({ ...t, matchState: 'review' }, 'refresh')?.state).toBe(
      'auto'
    )
    expect(
      reusableRef({ ...t, matchState: 'locked', type: 'series' }, 'force')
    ).toEqual({
      ref: { provider: 'tmdb', kind: 'tv', id: '42' },
      state: 'locked',
    })
    expect(reusableRef({ ...t, tmdbId: null }, 'refresh')).toBeNull()
  })

  it('手动搜索的解析结果；并发数；去扩展名', () => {
    expect(manualParsed('movie', { title: 'A', year: 1 })).toEqual({
      type: 'movie',
      title: 'A',
      year: 1,
    })
    expect(manualParsed('tv', { title: 'B' })).toEqual({
      type: 'episode',
      title: 'B',
      year: undefined,
      episodes: [],
    })
    expect(workerCount(undefined, 100)).toBe(8)
    expect(workerCount(3, 100)).toBe(3)
    expect(workerCount(8, 2)).toBe(2)
    expect(workerCount(8, 0)).toBe(1)
    expect(stem('a.b.mkv')).toBe('a.b')
  })
})

describe('识别模块规则', () => {
  it('任务键、目标范围、刷新时过期的缓存键', () => {
    expect(identifyJobKey({ mode: 'force', libraryId: 2 })).toBe(
      'identify:force:library:2'
    )
    expect(identifyJobKey({ mode: 'identify', itemIds: [1] })).toBe(
      'identify:identify:items'
    )
    expect(targetScope('refresh')).toBe('matched')
    expect(targetScope('force')).toBe('force')
    expect(targetScope('identify')).toBe('pending')
    expect(
      refreshCacheKeys([
        { type: 'movie', tmdbId: '1' },
        { type: 'series', tmdbId: '2' },
      ])
    ).toEqual(['tmdb:/movie/1?', 'tmdb:/tv/2?', 'tmdb:/tv/2/'])
  })

  it('进度事件：force 记作 identify，错误只在有时带上', () => {
    const s: RunSummary = {
      total: 3,
      done: 2,
      matched: 1,
      review: 1,
      unmatched: 0,
      failed: 0,
      changes: new ItemChanges(),
    }
    expect(progressEvent(7, { mode: 'force' }, s, false)).toEqual({
      type: 'identify-progress',
      jobId: 7,
      mode: 'identify',
      libraryId: null,
      total: 3,
      done: 2,
      matched: 1,
      review: 1,
      unmatched: 0,
      failed: 0,
      finished: false,
    })
    const e = progressEvent(7, { mode: 'refresh', libraryId: 4 }, s, true, 'x')
    expect([e.mode, e.libraryId, e.finished, e.error]).toEqual([
      'refresh',
      4,
      true,
      'x',
    ])
  })

  it('变化按媒体库拆分，查不到库的丢弃', () => {
    const events = itemsChangedEvents(
      changes([1, 2], [3, 9]),
      new Map([
        [1, 10],
        [2, 20],
        [3, 10],
      ])
    )
    expect(events).toEqual([
      {
        type: 'items-changed',
        libraryId: 10,
        added: [1],
        updated: [3],
        removed: [],
        reset: false,
      },
      {
        type: 'items-changed',
        libraryId: 20,
        added: [2],
        updated: [],
        removed: [],
        reset: false,
      },
    ])
  })

  it('分段推送每个 id 只推一次', () => {
    const emitted = new Set<number>()
    const first = takeFreshChanges(changes([1], [2]), emitted)
    expect([[...first.added], [...first.updated]]).toEqual([[1], [2]])
    const second = takeFreshChanges(changes([1, 3], [2, 4]), emitted)
    expect([[...second.added], [...second.updated]]).toEqual([[3], [4]])
    expect([...emitted].sort()).toEqual([1, 2, 3, 4])
  })

  it('打分候选转 IPC：breakdown 只留数字，海报拼 w185', () => {
    const info = scoredInfo({
      ...scored('5', 0.9),
      candidate: {
        ref: { provider: 'tmdb', kind: 'movie', id: '5' },
        title: 'T',
        posterPath: '/p.jpg',
        overview: 'o'.repeat(500),
      },
    })
    expect(info.breakdown).toEqual({ title: 0.81234 })
    expect(info.poster).toBe('https://image.tmdb.org/t/p/w185/p.jpg')
    expect(info.overview?.length).toBe(160)
    expect([info.confidence, info.originalTitle, info.year]).toEqual([
      0.9,
      null,
      null,
    ])
  })

  it('令牌错误转 invalid-params，其余原样', () => {
    const auth = toLibraryError(new ProviderAuthError('bad token'))
    expect(auth).toBeInstanceOf(LibraryError)
    expect((auth as LibraryError).code).toBe('invalid-params')
    const lib = new LibraryError('conflict', 'x')
    expect(toLibraryError(lib)).toBe(lib)
    const other = new Error('net')
    expect(toLibraryError(other)).toBe(other)
  })
})

describe('识别仓库行转换', () => {
  it('目标 / 文件 / 子条目的可空列', () => {
    expect(
      toTarget({
        id: 1,
        library_id: 2,
        type: 'movie',
        local_key: 'k',
        title: 't',
        year: null,
        match_state: 'auto',
        tmdb_id: 5,
      })
    ).toEqual({
      id: 1,
      libraryId: 2,
      type: 'movie',
      localKey: 'k',
      title: 't',
      year: null,
      matchState: 'auto',
      tmdbId: '5',
      source: 'tmdb',
    })
    const f = toTargetFile({
      item_id: 3,
      id: 4,
      display_path: '/a/b.mkv',
      dir: '/a',
      name: 'b.mkv',
      size: 10,
      parsed: '{bad',
      fingerprint: null,
      duration: 61,
    })
    expect([f.itemId, f.parsed, f.fingerprint, f.duration]).toEqual([
      3,
      null,
      null,
      61,
    ])
    expect(
      toTargetFile({ parsed: '{"type":"movie","title":"x"}' }).parsed
    ).toEqual({
      type: 'movie',
      title: 'x',
    })
    expect(
      toChild({
        id: 1,
        type: 'episode',
        parent_id: 2,
        season_number: null,
        episode_number: 3,
        local_key: 'e',
      })
    ).toEqual({
      id: 1,
      type: 'episode',
      parentId: 2,
      season: null,
      episode: 3,
      localKey: 'e',
    })
  })

  it('匹配记录：provider_id 拆成 kind / id，坏候选当空标题', () => {
    expect(matchProviderId({ kind: 'tv', id: '9' })).toBe('tv:9')
    expect(
      toMatch({
        provider_id: 'tv:9',
        status: 'locked',
        confidence: '0.5',
        candidate: 'x',
      })
    ).toEqual({
      ref: { provider: 'tmdb', kind: 'tv', id: '9' },
      status: 'locked',
      confidence: 0.5,
      candidate: { title: '' },
    })
  })

  it('候选摘要：分数保留三位，空字段不写，简介截断', () => {
    expect(
      storedCandidate(
        {
          ref: { provider: 'tmdb', kind: 'movie', id: '1' },
          title: 'T',
          year: 0,
          overview: 'x'.repeat(200),
        },
        { a: 0.123456, b: 'no' }
      )
    ).toEqual({
      title: 'T',
      overview: 'x'.repeat(160),
      breakdown: { a: 0.123 },
    })
    expect(
      storedCandidate({
        ref: { provider: 'tmdb', kind: 'movie', id: '1' },
        title: 'T',
      })
    ).toEqual({ title: 'T' })
  })
})

describe('媒体库服务规则', () => {
  it('扫描键、优先级、items-changed（超量 reset、无变化 null）', () => {
    expect(scanJobKey(3)).toBe('library:3')
    expect(SERVICE_PRIORITY.scan).toBeGreaterThan(SERVICE_PRIORITY.watch)
    expect(itemsChangedEvent(1, new ItemChanges())).toBeNull()
    const c = changes([1], [2])
    c.removed.add(3)
    expect(itemsChangedEvent(1, c)).toEqual({
      type: 'items-changed',
      libraryId: 1,
      added: [1],
      updated: [2],
      removed: [3],
      reset: false,
    })
    const big = changes(
      Array.from({ length: ITEMS_CHANGED_LIMIT }, (_, i) => i)
    )
    expect(itemsChangedEvent(1, big)?.reset).toBe(false)
    big.updated.add(-1)
    expect(itemsChangedEvent(1, big)).toMatchObject({
      reset: true,
      added: [],
      updated: [],
    })
  })

  it('切块', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks([], 3)).toEqual([])
  })
})

describe('写出层规则', () => {
  const move = (
    itemId: number,
    kind: PlannedMove['kind'],
    from: string,
    conflict?: string
  ): PlannedMove => ({
    itemId,
    libraryId: 1,
    kind,
    from,
    to: `${from}!`,
    crossDevice: false,
    ...(conflict ? { conflict } : {}),
  })

  it('写出合并取并集', () => {
    expect(mergeWritePayload({ itemIds: [1, 2] }, { itemIds: [2, 3] })).toEqual(
      {
        itemIds: [1, 2, 3],
      }
    )
  })

  it('整理步骤：去冲突，视频 → 旁挂 → 文件夹，同类保持顺序', () => {
    const { ops, itemIds } = organizeOps([
      move(2, 'folder', 'f'),
      move(1, 'sidecar', 's1'),
      move(3, 'video', 'bad', '冲突'),
      move(1, 'video', 'v1'),
      move(2, 'sidecar', 's2'),
      move(2, 'video', 'v2'),
    ])
    expect(ops.map(o => o.src)).toEqual(['v1', 'v2', 's1', 's2', 'f'])
    expect(ops[0]).toEqual({
      itemId: 1,
      libraryId: 1,
      kind: 'video',
      src: 'v1',
      dst: 'v1!',
      crossDevice: false,
    })
    expect(itemIds).toEqual([2, 1])
  })

  it('批次状态', () => {
    expect(['done', 'partial', 'failed'].every(s => canUndo(s as never))).toBe(
      true
    )
    expect(
      ['running', 'undoing', 'undone'].some(s => canUndo(s as never))
    ).toBe(false)
    expect(organizeFinalState({ failed: 0, moved: 0 })).toBe('done')
    expect(organizeFinalState({ failed: 1, moved: 2 })).toBe('partial')
    expect(organizeFinalState({ failed: 1, moved: 0 })).toBe('failed')
    expect(undoFinalState({ failed: 0 })).toBe('undone')
    expect(undoFinalState({ failed: 2 })).toBe('partial')
  })

  it('预览计划过期（严格大于有效期）', () => {
    const plans = new Map([
      ['a', { createdAt: 0 }],
      ['b', { createdAt: 50 }],
    ])
    expect(expiredPlans(plans, 100, 50)).toEqual(['a'])
    expect(expiredPlans(plans, 100, 100)).toEqual([])
  })

  it('节流：间隔内丢弃，finished 总是放行', () => {
    let t = 1000
    const sent: Array<[number, boolean]> = []
    const send = throttled<number>(
      (v, f) => sent.push([v, f]),
      () => t,
      250
    )
    send(1, false)
    t += 100
    send(2, false)
    send(3, true)
    t += 249
    send(4, false)
    t += 1
    send(5, false)
    expect(sent).toEqual([
      [1, false],
      [3, true],
      [5, false],
    ])
  })

  it('整理计数 → 进度；路径变化事件按库分组', () => {
    expect(
      organizeProgress({
        total: 5,
        done: 4,
        moved: 3,
        skipped: 1,
        failed: 0,
        lastError: 'x',
      })
    ).toEqual({ total: 5, done: 4, written: 3, skipped: 1, failed: 0 })
    const lib: Record<number, number> = { 1: 10, 2: 20, 3: 10 }
    expect(itemsUpdatedEvents([1, 2, 3, 4], id => lib[id])).toEqual([
      {
        type: 'items-changed',
        libraryId: 10,
        added: [],
        updated: [1, 3],
        removed: [],
        reset: false,
      },
      {
        type: 'items-changed',
        libraryId: 20,
        added: [],
        updated: [2],
        removed: [],
        reset: false,
      },
    ])
  })

  it('分段后缀、旁挂归属取最长前缀、视频冲突连带阻止', () => {
    expect(withPart('/a/M.mkv', 0, 1)).toBe('/a/M.mkv')
    expect(withPart('/a/M.mkv', 1, 2)).toBe('/a/M - part2.mkv')
    const owners = [{ stem: 'Movie' }, { stem: 'Movie.part2' }]
    expect(sidecarOwner('Movie.part2.srt', owners)).toBe(owners[1])
    expect(sidecarOwner('Movie-poster.jpg', owners)).toBe(owners[0])
    expect(sidecarOwner('Movies.srt', owners)).toBeUndefined()
    expect(sidecarOwner('Movie', owners)).toBeUndefined()
    const moves = [
      move(1, 'video', 'v', '目标已存在'),
      move(1, 'sidecar', 's'),
      move(2, 'sidecar', 't'),
      move(1, 'folder', 'f', '路径过长'),
    ]
    blockWithConflictingVideo(moves)
    expect(moves.map(m => m.conflict)).toEqual([
      '目标已存在',
      '同条目的视频有冲突，暂不移动',
      undefined,
      '路径过长',
    ])
  })
})

describe('TMDB 映射拆分', () => {
  it('文本工具', () => {
    expect(yearOf('2020-01-02')).toBe(2020)
    expect(yearOf('x')).toBeUndefined()
    expect(nonEmpty('  a ')).toBe('a')
    expect(nonEmpty('  ')).toBeUndefined()
    const tr = [
      { iso_639_1: 'zh', iso_3166_1: 'TW', data: { title: '台' } },
      { iso_639_1: 'zh', iso_3166_1: 'CN', data: { title: ' ' } },
      { iso_639_1: 'en', iso_3166_1: 'US', data: { title: 'En' } },
    ]
    expect(
      pickTranslation(tr, ['zh-CN', 'zh-TW', 'en'], t => t.data?.title)
    ).toEqual({ value: '台', language: 'zh-TW' })
    expect(pickTranslation(tr, ['en'], t => t.data?.title)).toEqual({
      value: 'En',
      language: 'en-US',
    })
    expect(pickTranslation([], ['en'], t => t.data?.title)).toBeUndefined()
  })

  it('分级：大陆 > 美国 > 任意；电影院线优先', () => {
    const d = {
      id: 1,
      release_dates: {
        results: [
          {
            iso_3166_1: 'US',
            release_dates: [
              { type: 4, certification: 'R-dvd' },
              { type: 3, certification: 'R' },
            ],
          },
          {
            iso_3166_1: 'JP',
            release_dates: [{ type: 3, certification: 'G' }],
          },
        ],
      },
    } as unknown as TmdbDetails
    expect(certificationOf('movie', d)).toBe('R')
    const tv = {
      id: 1,
      content_ratings: {
        results: [
          { iso_3166_1: 'JP', rating: 'G' },
          { iso_3166_1: 'CN', rating: '' },
        ],
      },
    } as unknown as TmdbDetails
    expect(certificationOf('tv', tv)).toBe('G')
  })

  it('演员表按 order 取前几位；幕后去重、导演在前、剧集带创作者', () => {
    const cast = Array.from({ length: CAST_LIMIT + 3 }, (_, i) => ({
      id: i,
      name: `A${i}`,
      order: CAST_LIMIT + 3 - i,
    }))
    const d = {
      id: 1,
      credits: {
        cast,
        crew: [
          { id: 1, name: 'W', job: 'Writer' },
          { id: 2, name: 'D', job: 'Director' },
          { id: 2, name: 'D', job: 'Director' },
          { id: 3, name: 'X', job: 'Gaffer' },
        ],
      },
      created_by: [{ id: 9, name: 'C' }],
    } as unknown as TmdbDetails
    const c = castOf(d)
    expect(c.length).toBe(CAST_LIMIT)
    expect(c[0].name).toBe(`A${CAST_LIMIT + 2}`)
    expect(crewOf('movie', d).map(p => `${p.name}:${p.job}`)).toEqual([
      'D:Director',
      'W:Writer',
    ])
    expect(crewOf('tv', d).map(p => p.job)).toEqual([
      'Director',
      'Creator',
      'Writer',
    ])
  })

  it('图片列表为空时用主图兜底', () => {
    expect(toImages('poster', [], '/p.jpg')).toEqual([
      {
        role: 'poster',
        path: '/p.jpg',
        language: null,
        width: 0,
        height: 0,
        voteAverage: 0,
        voteCount: 0,
      },
    ])
    expect(toImages('logo', undefined)).toEqual([])
    expect(
      toImages(
        'backdrop',
        [{ file_path: '/b', iso_639_1: 'en', width: 10 }],
        '/x'
      )
    ).toMatchObject([{ path: '/b', language: 'en', width: 10 }])
  })
})
