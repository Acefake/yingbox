/**
 * NFO 生成快照、XML 转义与合并模式。
 */
import { describe, expect, it } from 'vitest'
import { parseNfo } from '../../../src/shared/library/identify/nfo'
import {
  buildEpisodeNfo,
  buildMovieNfo,
  buildSeasonNfo,
  buildTvShowNfo,
  renderNfo,
} from '../../../src/main/library/writer/nfo/nfo-builder'
import {
  type FieldSnapshot,
  composeNfo,
} from '../../../src/main/library/writer/nfo/nfo-merge'
import {
  escapeXml,
  innerText,
  parseRoots,
} from '../../../src/main/library/writer/nfo/xml'
import { EPISODES, MOVIE, SEASON, SERIES } from './fixtures'

describe('NFO 生成', () => {
  it('电影：字段完整、转义正确（快照）', () => {
    const text = renderNfo([buildMovieNfo(MOVIE)])
    expect(text).toMatchSnapshot()
    expect(text).toContain('<title>流浪地球 &amp; &lt;特别版&gt;</title>')
    expect(text).toContain(
      '<originaltitle>The Wandering Earth &quot;Director&apos;s Cut&quot;</originaltitle>'
    )
    expect(text).not.toContain('\u0007')
    expect(text).toContain('🌍')
    expect(text).toContain(
      '<uniqueid type="tmdb" default="true">535167</uniqueid>'
    )
    expect(text).toContain('<country>中国</country>')
    // svg 标志跳过，png 进 thumb
    expect(text).toContain(
      '<thumb aspect="clearlogo">https://image.tmdb.org/t/p/original/logo.png</thumb>'
    )
  })

  it('剧集 / 季 / 集（含一个文件两集）快照', () => {
    expect(renderNfo([buildTvShowNfo(SERIES)])).toMatchSnapshot('tvshow')
    expect(renderNfo([buildSeasonNfo(SEASON, SERIES)])).toMatchSnapshot(
      'season'
    )
    expect(
      renderNfo(EPISODES.map(e => buildEpisodeNfo(e, SERIES)))
    ).toMatchSnapshot('episode')
  })

  it('生成的 NFO 能被读回（自己的 NFO 解析器与容错切块）', () => {
    const movie = renderNfo([buildMovieNfo(MOVIE)])
    expect(parseNfo(movie)).toMatchObject({
      kind: 'movie',
      ids: { tmdb: '535167', imdb: 'tt7605074' },
      year: 2019,
    })
    const tv = parseNfo(renderNfo([buildTvShowNfo(SERIES)]))
    expect(tv).toMatchObject({
      kind: 'tvshow',
      ids: { tmdb: '64010', tvdb: '299945' },
    })
    const roots = parseRoots(
      renderNfo(EPISODES.map(e => buildEpisodeNfo(e, SERIES)))
    )!
    expect(roots.map(r => r.name)).toEqual(['episodedetails', 'episodedetails'])
    const title = roots[0].children.find(c => c.name === 'title')!
    expect(innerText(title.raw)).toBe('再见，初恋 & 你好')
  })

  it('escapeXml 去掉非法字符与孤立代理', () => {
    expect(escapeXml('a\u0000b\ud800c&')).toBe('abc&amp;')
    expect(escapeXml('😀')).toBe('😀')
  })
})

describe('合并模式', () => {
  const ours = [buildMovieNfo(MOVIE)]
  const write = (
    existing: string | null,
    last: FieldSnapshot | null,
    mode: 'merge' | 'overwrite' = 'merge'
  ): { content: string; snapshot: FieldSnapshot } => {
    const outcome = composeNfo(ours, existing, mode, last)
    if (outcome.kind !== 'write') throw new Error('unexpected lock')
    return outcome
  }

  it('首次写出：没有旧文件时就是完整生成结果', () => {
    expect(write(null, null).content).toBe(renderNfo(ours))
  })

  it('用户手改的字段保留，没改的字段随新数据更新，删掉的字段不补回', () => {
    const first = write(null, null)
    const edited = first.content
      .replace(
        '<title>流浪地球 &amp; &lt;特别版&gt;</title>',
        '<title>我的片名</title>'
      )
      .replace(/\s*<tagline>[^<]*<\/tagline>/, '')
    // 上游元数据变了：简介更新
    const updated = composeNfo(
      [buildMovieNfo({ ...MOVIE, overview: '新的简介' })],
      edited,
      'merge',
      first.snapshot
    )
    if (updated.kind !== 'write') throw new Error()
    expect(updated.content).toContain('<title>我的片名</title>')
    expect(updated.content).toContain('<plot>新的简介</plot>')
    expect(updated.content).not.toContain('<tagline>')
    // 快照记录的是我们生成的值，下次仍能认出用户改过的 title
    const again = composeNfo(
      [buildMovieNfo(MOVIE)],
      updated.content,
      'merge',
      updated.snapshot
    )
    if (again.kind !== 'write') throw new Error()
    expect(again.content).toContain('<title>我的片名</title>')
  })

  it('其他工具写的 NFO：保留其字段与未知扩展字段，补齐缺少的字段和 tmdb uniqueid', () => {
    const foreign = `<?xml version="1.0" encoding="utf-8"?>
<!-- tinyMediaManager -->
<movie>
  <title>The Wandering Earth</title>
  <plot></plot>
  <uniqueid type="imdb" default="true">tt7605074</uniqueid>
  <!-- user note -->
  <tmm:custom attr="a > b">keep me</tmm:custom>
  <fileinfo><streamdetails><video><codec>hevc</codec></video></streamdetails></fileinfo>
</movie>
https://www.themoviedb.org/movie/535167`
    const { content } = write(foreign, null)
    expect(content).toContain('<title>The Wandering Earth</title>')
    expect(content).toContain('<plot>太阳即将毁灭') // 空元素视为没写
    expect(content).toContain(
      '<uniqueid type="imdb" default="true">tt7605074</uniqueid>'
    )
    expect(content).toContain(
      '<uniqueid type="tmdb" default="true">535167</uniqueid>'
    )
    expect(content).toContain('<tmm:custom attr="a > b">keep me</tmm:custom>')
    expect(content).toContain('<!-- user note -->')
    expect(content).toContain('<codec>hevc</codec>')
    expect(content).toContain('<genre>科幻</genre>')
    expect(parseRoots(content)).toHaveLength(1)
  })

  it('覆盖模式整份重写；lockdata=true 两种模式都不写', () => {
    expect(
      write('<movie><title>x</title></movie>', null, 'overwrite').content
    ).toBe(renderNfo(ours))
    const locked = '<movie><title>x</title><lockdata>true</lockdata></movie>'
    expect(composeNfo(ours, locked, 'merge', null)).toEqual({ kind: 'locked' })
    expect(composeNfo(ours, locked, 'overwrite', null)).toEqual({
      kind: 'locked',
    })
  })

  it('读不懂的旧文件（只有网址 / 标签不配对）不报错，按新文件处理', () => {
    expect(write('https://www.imdb.com/title/tt7605074/', null).content).toBe(
      renderNfo(ours)
    )
    expect(write('<movie><title>broken</movie>', null).content).toBe(
      renderNfo(ours)
    )
    expect(write('', null).content).toBe(renderNfo(ours))
  })

  it('根元素不同（movie 文件里写剧集）时用新内容', () => {
    expect(write('<tvshow><title>x</title></tvshow>', null).content).toBe(
      renderNfo(ours)
    )
  })
})
