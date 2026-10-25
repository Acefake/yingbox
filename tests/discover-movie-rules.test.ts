import { describe, expect, it } from 'vitest'

import type { NetdiskItem } from '../src/shared/contract/pan115'

import { Pan115Error } from '../src/main/pan115/errors'
import {
  createMovieFinder,
  movieKeywords,
  rankMovieShares,
} from '../src/main/discover/movie-finder'
import {
  MAX_MOVIE_SIZE,
  MIN_MOVIE_SIZE,
  type MovieTarget,
  featureVideoCount,
  matchMovieFile,
  movieFolderWorthOpening,
  yearsIn,
} from '../src/main/discover/movie-rules'

const GB = 1024 ** 3
const target: MovieTarget = {
  title: '星际穿越',
  originalTitle: 'Interstellar',
  year: 2014,
}
const top = { shareTitle: '', folder: '' }
const file = (
  name: string,
  size = 8 * GB
): { name: string; size: number; isDir: boolean } => ({
  name,
  size,
  isDir: false,
})

describe('电影认文件', () => {
  it('中文名 + 年份 + 4K + 中字 + 片源：通过并给出加分理由', () => {
    const match = matchMovieFile(
      file('星际穿越.Interstellar.2014.2160p.BluRay.x265.中英字幕.mkv'),
      target,
      top
    )
    expect(match.ok).toBe(true)
    if (!match.ok) return
    expect(match.reasons).toEqual(
      expect.arrayContaining([
        '文件名含片名',
        '2014 年',
        '4K',
        '中文字幕',
        '片源标注',
        '体积正常',
      ])
    )
    expect(match.score).toBeGreaterThanOrEqual(90)
  })

  it('原名也认；Remux 比普通片源分高', () => {
    const remux = matchMovieFile(
      file('Interstellar.2014.1080p.REMUX.mkv'),
      target,
      top
    )
    const web = matchMovieFile(
      file('Interstellar.2014.1080p.WEB-DL.mkv'),
      target,
      top
    )
    expect(remux.ok && web.ok).toBe(true)
    if (remux.ok && web.ok) expect(remux.score).toBeGreaterThan(web.score)
  })

  it('排除预告、花絮、枪版、CAM', () => {
    for (const name of [
      '星际穿越.2014.预告.mp4',
      '星际穿越.2014.花絮.mkv',
      '星际穿越.2014.枪版.mkv',
      'Interstellar.2014.CAM.mkv',
      'Interstellar.2014.HDTS.mkv',
    ])
      expect(matchMovieFile(file(name), target, top).ok, name).toBe(false)
    expect(
      matchMovieFile(file('Interstellar.2014.mkv'), target, {
        shareTitle: '',
        folder: 'Trailer',
      }).ok
    ).toBe(false)
  })

  it('体积在 500MB–60GB 之间', () => {
    expect(
      matchMovieFile(
        file('Interstellar.2014.mkv', MIN_MOVIE_SIZE - 1),
        target,
        top
      )
    ).toEqual({ ok: false, reason: '体积太小' })
    expect(
      matchMovieFile(
        file('Interstellar.2014.mkv', MAX_MOVIE_SIZE + 1),
        target,
        top
      )
    ).toEqual({ ok: false, reason: '体积太大' })
  })

  it('年份：一致加分，差一年也接受，差更多或没写拒绝', () => {
    expect(
      matchMovieFile(file('Interstellar.2015.mkv'), target, top)
    ).toMatchObject({
      ok: true,
      reasons: expect.arrayContaining(['年份差一年']),
    })
    expect(matchMovieFile(file('Interstellar.2018.mkv'), target, top)).toEqual({
      ok: false,
      reason: '年份对不上',
    })
    expect(matchMovieFile(file('Interstellar.mkv'), target, top)).toEqual({
      ok: false,
      reason: '没写年份',
    })
    // 年份写在所在文件夹 / 分享标题里也算
    expect(
      matchMovieFile(file('Interstellar.mkv'), target, {
        shareTitle: '星际穿越 (2014) 4K',
        folder: '',
      }).ok
    ).toBe(true)
  })

  it('片名对不上、剧集、分段、非视频都拒绝', () => {
    expect(matchMovieFile(file('Inception.2014.mkv'), target, top)).toEqual({
      ok: false,
      reason: '片名对不上',
    })
    expect(
      matchMovieFile(file('Interstellar.S01E02.2014.mkv'), target, top).ok
    ).toBe(false)
    expect(
      matchMovieFile(file('Interstellar.2014.CD1.mkv'), target, top)
    ).toEqual({ ok: false, reason: '分段文件' })
    expect(matchMovieFile(file('Interstellar.2014.srt'), target, top)).toEqual({
      ok: false,
      reason: '不是视频',
    })
  })

  it('文件名没写片名时，所在文件夹或分享标题对得上也认（分数更低）', () => {
    const inFolder = matchMovieFile(file('BDMV.2014.mkv'), target, {
      shareTitle: '',
      folder: '星际穿越',
    })
    expect(inFolder.ok).toBe(true)
    if (inFolder.ok) expect(inFolder.reasons).not.toContain('文件名含片名')
  })

  it('合集分享（同一层多个正片）：分享标题不替其它影片担保片名', () => {
    const collection = {
      shareTitle: '诺兰合集 星际穿越 盗梦空间 2010-2014',
      folder: '',
      shareVouches: false,
    }
    expect(
      matchMovieFile(file('Inception.2010.mkv'), target, collection)
    ).toEqual({ ok: false, reason: '片名对不上' })
    // 文件名自己写了片名照样认
    expect(
      matchMovieFile(file('星际穿越.2014.mkv'), target, collection).ok
    ).toBe(true)
    // 预告这类小文件、带排除字眼的不算正片
    expect(
      featureVideoCount([
        file('星际穿越.2014.mkv'),
        file('星际穿越.预告.mp4'),
        file('sample.mkv', 50 * 1024 * 1024),
        { name: '花絮', size: 0, isDir: true },
      ])
    ).toBe(1)
  })

  it('不知道上映年份：不核对、不加分，也不说「年份差一年」', () => {
    const match = matchMovieFile(
      file('Interstellar.2014.1080p.mkv'),
      { ...target, year: null },
      top
    )
    expect(match.ok).toBe(true)
    if (!match.ok) return
    expect(match.reasons).toContain('年份未核对')
    expect(match.reasons).not.toContain('年份差一年')
  })

  it('子文件夹：对得上片名才点进去，花絮文件夹不进', () => {
    expect(movieFolderWorthOpening('星际穿越 2014 4K', target)).toBe(true)
    expect(movieFolderWorthOpening('星际穿越 花絮', target)).toBe(false)
    expect(movieFolderWorthOpening('其他电影', target)).toBe(false)
  })

  it('年份提取', () => {
    expect(yearsIn('Interstellar.2014.2160p')).toEqual([2014])
    expect(yearsIn('1080p')).toEqual([])
  })
})

describe('电影找资源的关键词与分享排序', () => {
  it('片名 年份 → 片名 → 原名 年份，去重', () => {
    expect(movieKeywords(target)).toEqual([
      '星际穿越 2014',
      '星际穿越',
      'Interstellar 2014',
    ])
    expect(
      movieKeywords({
        title: '霸王别姬',
        originalTitle: '霸王别姬',
        year: null,
      })
    ).toEqual(['霸王别姬'])
  })

  it('标题对得上片名的分享在前，其次新的在前', () => {
    const item = (title: string, datetime: string): NetdiskItem => ({
      title,
      datetime,
      source: 'x',
      url: '',
      shareCode: title,
      receiveCode: '',
    })
    const ranked = rankMovieShares(
      [
        item('无关合集', '2026-10-01'),
        item('星际穿越 旧', '2025-01-01'),
        item('Interstellar 新', '2026-01-01'),
      ],
      target
    )
    expect(ranked.map(i => i.title)).toEqual([
      'Interstellar 新',
      '星际穿越 旧',
      '无关合集',
    ])
  })
})

describe('电影查找器', () => {
  const share = (code: string): NetdiskItem => ({
    title: `星际穿越 2014 ${code}`,
    source: 'tg:x',
    url: `https://115.com/s/${code}`,
    shareCode: code,
    receiveCode: '',
  })

  it('看到一半出错：已找到的候选照样交出来；一个都没有才抛错', async () => {
    const risk = new Pan115Error('操作太频繁，请稍后再试', 911)
    const finder = createMovieFinder({
      search: async () => [share('a'), share('b')],
      snap: async item => {
        if (item.shareCode === 'b') throw risk
        // 分数不到「够好」，会接着看下一个分享
        return {
          title: '',
          count: 1,
          files: [{ id: 'f1', ...file('星际穿越.2014.mkv', GB) }],
        }
      },
      blocked: () => false,
      block: () => {},
      now: () => 0,
    })
    const result = await finder.find(target)
    expect(result.candidates.map(c => c.fileId)).toEqual(['f1'])

    const empty = createMovieFinder({
      search: async () => [share('b')],
      snap: async () => {
        throw risk
      },
      blocked: () => false,
      block: () => {},
      now: () => 0,
    })
    await expect(empty.find(target)).rejects.toBe(risk)
  })
})
