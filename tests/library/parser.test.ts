import { describe, expect, it } from 'vitest'
import { parseMediaPath } from '../../src/shared/library/parser'

describe('parseMediaPath', () => {
  it('拆分中英双标题并剥离发布信息', () => {
    expect(
      parseMediaPath(
        '/m/流浪地球.The.Wandering.Earth.2019.2160p.WEB-DL.H265.HDR.DDP5.1-HHWEB.mkv'
      )
    ).toEqual({
      type: 'movie',
      title: '流浪地球',
      altTitle: 'The Wandering Earth',
      year: 2019,
    })
  })

  it('片名里像年份的数字留在片名里，取最后一个年份', () => {
    expect(parseMediaPath('/m/1917.2019.1080p.mkv')).toMatchObject({
      title: '1917',
      year: 2019,
    })
    expect(parseMediaPath('/m/Blade.Runner.2049.2017.mkv')).toMatchObject({
      title: 'Blade Runner 2049',
      year: 2017,
    })
    expect(parseMediaPath('/m/1917.1080p.BluRay.mkv')).toEqual({
      type: 'movie',
      title: '1917',
    })
  })

  it('流媒体缩写只在片名之后才算噪音', () => {
    expect(
      parseMediaPath('/m/Mad.Max.Fury.Road.2015.MAX.WEB-DL.1080p.mkv')
    ).toMatchObject({ title: 'Mad Max Fury Road', year: 2015 })
  })

  it('通用文件名回退到最近的承载片名的文件夹', () => {
    expect(
      parseMediaPath('D:\\Movies\\Heat (1995)\\VIDEO_TS\\VTS_01_1.VOB')
    ).toEqual({ type: 'movie', title: 'Heat', year: 1995 })
    expect(parseMediaPath('/m/Home Alone (1990)/CD2/movie.avi')).toEqual({
      type: 'movie',
      title: 'Home Alone',
      year: 1990,
      part: 2,
    })
  })

  it('文件名缺年份时，从同名文件夹补齐年份和 ID', () => {
    expect(
      parseMediaPath('/m/Inception (2010) [imdbid-tt1375666]/Inception.mkv')
    ).toEqual({
      type: 'movie',
      title: 'Inception',
      year: 2010,
      ids: { imdb: 'tt1375666' },
    })
  })

  it('识别各种剧集写法', () => {
    expect(
      parseMediaPath('/tv/Lost/Season 1/Lost.S01E01-E03.mkv')
    ).toMatchObject({
      type: 'episode',
      season: 1,
      episodes: [1, 2, 3],
    })
    expect(parseMediaPath('/tv/X/X.S03E10E11.mkv')).toMatchObject({
      episodes: [10, 11],
    })
    expect(parseMediaPath('/tv/Friends/Friends 10x17.avi')).toMatchObject({
      season: 10,
      episodes: [17],
    })
    expect(
      parseMediaPath('/tv/权力的游戏/权力的游戏 第1季第3集.mp4')
    ).toMatchObject({
      title: '权力的游戏',
      season: 1,
      episodes: [3],
    })
    expect(parseMediaPath('/tv/繁花/繁花 第十二集.mp4')).toMatchObject({
      episodes: [12],
    })
  })

  it('剧集文件只有集号时，剧名、年份、季号来自文件夹', () => {
    expect(parseMediaPath('/tv/The Wire (2002)/Season 3/S03E05.mkv')).toEqual({
      type: 'episode',
      title: 'The Wire',
      year: 2002,
      season: 3,
      episodes: [5],
    })
    expect(parseMediaPath('/tv/24/Season 01/10.mkv')).toMatchObject({
      title: '24',
      season: 1,
      episodes: [10],
    })
  })

  it('动画绝对集数：组名方括号、` - 03`、[03]，季文件夹存在时不算绝对集数', () => {
    expect(
      parseMediaPath(
        '/a/One Piece/[SubsPlease] One Piece - 1080 (1080p) [ABCDEF12].mkv'
      )
    ).toEqual({
      type: 'episode',
      title: 'One Piece',
      episodes: [1080],
      absolute: true,
    })
    expect(
      parseMediaPath(
        '/a/x/【喵萌奶茶屋】★10月新番★[葬送的芙莉莲][03][1080p][简日双语].mp4'
      )
    ).toMatchObject({ title: '葬送的芙莉莲', episodes: [3], absolute: true })
    expect(
      parseMediaPath(
        '/a/K/Season 1/[Erai-raws] Kimetsu no Yaiba - 19 [1080p].mkv'
      )
    ).toEqual({
      type: 'episode',
      title: 'Kimetsu no Yaiba',
      season: 1,
      episodes: [19],
    })
  })

  it('中文剧名后的裸数字是集号，但不是绝对集数', () => {
    expect(parseMediaPath('/tv/甄嬛传/甄嬛传 76.mp4')).toEqual({
      type: 'episode',
      title: '甄嬛传',
      episodes: [76],
    })
  })

  it('S00 与 Specials 文件夹是特别篇', () => {
    expect(parseMediaPath('/tv/Sherlock/Specials/E01.mkv')).toMatchObject({
      title: 'Sherlock',
      season: 0,
      episodes: [1],
    })
  })

  it('日期节目给出播出日期', () => {
    expect(
      parseMediaPath(
        '/tv/The Daily Show/The.Daily.Show.2024.03.15.720p.WEB.mkv'
      )
    ).toEqual({
      type: 'episode',
      title: 'The Daily Show',
      episodes: [],
      airDate: '2024-03-15',
    })
    expect(
      parseMediaPath('/tv/快乐大本营/快乐大本营.20240315.mp4')
    ).toMatchObject({
      airDate: '2024-03-15',
    })
  })

  it('附加内容归属到所在作品', () => {
    expect(parseMediaPath('/m/Dune (2021)/Featurettes/Making Of.mkv')).toEqual({
      type: 'extra',
      title: 'Dune',
      year: 2021,
    })
    expect(parseMediaPath('/m/Dune (2021)/Dune (2021)-trailer.mkv')).toEqual({
      type: 'extra',
      title: 'Dune',
      year: 2021,
    })
    // 片名开头的关键字不算附加内容
    expect(
      parseMediaPath(
        '/m/Trailer Park Boys The Movie (2006)/Trailer Park Boys The Movie (2006).mkv'
      )
    ).toMatchObject({ type: 'movie' })
  })

  it('抽取文件名里的外部 ID', () => {
    expect(
      parseMediaPath('/m/Dune (2021) {imdb-tt1160419} {tmdb-438631}.mkv')
    ).toMatchObject({ ids: { imdb: 'tt1160419', tmdb: '438631' } })
    expect(
      parseMediaPath('/tv/Show (2019) {tvdb-81189}/Season 1/Show S01E01.mkv')
    ).toMatchObject({ ids: { tvdb: '81189' } })
  })

  it('去掉资源站前缀和网址', () => {
    expect(
      parseMediaPath(
        '/m/阳光电影www.ygdy8.com.我不是药神.HD.1080p.国语中字.mkv'
      )
    ).toEqual({ type: 'movie', title: '我不是药神' })
  })
})
