import { describe, expect, it } from 'vitest'
import { parseNfo } from '../../src/shared/library/identify'

describe('parseNfo', () => {
  it('读取 Kodi / Jellyfin 的 uniqueid', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>The Matrix</title>
  <year>1999</year>
  <uniqueid type="imdb">tt0133093</uniqueid>
  <uniqueid type="tmdb" default="true">603</uniqueid>
</movie>`
    expect(parseNfo(xml)).toEqual({
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      ids: { imdb: 'tt0133093', tmdb: '603' },
    })
  })

  it('兼容旧式标签和 <id>tt…</id>', () => {
    expect(
      parseNfo('<tvshow><tvdbid>81189</tvdbid><id>tt0903747</id></tvshow>')
    ).toMatchObject({
      kind: 'tvshow',
      ids: { tvdb: '81189', imdb: 'tt0903747' },
    })
  })

  it('只有网址的 NFO', () => {
    expect(
      parseNfo('https://www.themoviedb.org/movie/603-the-matrix').ids
    ).toEqual({
      tmdb: '603',
    })
    expect(parseNfo('http://www.imdb.com/title/tt0133093/').ids).toEqual({
      imdb: 'tt0133093',
    })
  })

  it('丢弃格式不对的 ID', () => {
    expect(
      parseNfo(
        '<movie><uniqueid type="tmdb">abc</uniqueid><imdbid>133093</imdbid></movie>'
      ).ids
    ).toEqual({})
  })
})
