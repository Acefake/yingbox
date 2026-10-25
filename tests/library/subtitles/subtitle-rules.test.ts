/**
 * 自动字幕的纯规则：认中文外挂 / 内封 / 文件名、挑字幕、存放名、重试间隔、OpenSubtitles 参数与响应解析。
 */
import { describe, expect, it } from 'vitest'
import {
  hitsFromBody,
  searchParams,
} from '../../../src/main/library/subtitles/os-subtitles'
import {
  type SubtitleHit,
  nameSaysChinese,
  nextRetry,
  pickSubtitle,
  scanSidecars,
  streamsHaveChinese,
  subtitleFileName,
  suffixSaysChinese,
  textLooksChinese,
} from '../../../src/main/library/subtitles/subtitle-rules'

describe('中文字幕判断', () => {
  it('同名字幕的语言后缀', () => {
    for (const suffix of [
      '.zh',
      '.chs',
      '.cht',
      '.zh-CN',
      '.zh-Hant',
      '.简体',
      '.中文',
      '.chs&eng',
      '_sc',
    ])
      expect(suffixSaysChinese(suffix), suffix).toBe(true)
    for (const suffix of ['.en', '.eng', '.forced', '.jpn'])
      expect(suffixSaysChinese(suffix), suffix).toBe(false)
  })

  it('只看以视频名开头的字幕；无标记的单独列出', () => {
    const found = scanSidecars('/m/Dune (2021).mkv', [
      'Dune (2021).mkv',
      'Dune (2021).zh.srt',
      'Dune (2021).en.srt',
      'Dune (2021).ass',
      'Other.chs.srt',
      'Dune (2021).nfo',
    ])
    expect(found).toEqual({
      chinese: ['Dune (2021).zh.srt'],
      unlabeled: ['Dune (2021).ass'],
    })
  })

  it('字幕正文按汉字比例判断', () => {
    expect(
      textLooksChinese('1\n00:00:01,000 --> 00:00:02,000\n你好，世界\n')
    ).toBe(true)
    expect(
      textLooksChinese('1\n00:00:01,000 --> 00:00:02,000\nHello world\n')
    ).toBe(false)
  })

  it('文件名标了中字', () => {
    expect(nameSaysChinese('/tv/某剧.S01E01.1080p.中英双字.mkv')).toBe(true)
    expect(nameSaysChinese('/m/Movie.2021.CHS.1080p.mkv')).toBe(true)
    expect(nameSaysChinese('/m/Chess.Story.2021.mkv')).toBe(false)
  })

  it('内封字幕流的 language / title', () => {
    const streams = (tags: Record<string, string>): unknown => ({
      streams: [{ codec_type: 'subtitle', tags }],
    })
    expect(streamsHaveChinese(streams({ language: 'chi' }))).toBe(true)
    expect(
      streamsHaveChinese(streams({ language: 'und', title: '简体中文' }))
    ).toBe(true)
    expect(streamsHaveChinese(streams({ language: 'eng' }))).toBe(false)
    expect(streamsHaveChinese(null)).toBe(false)
  })
})

const hit = (patch: Partial<SubtitleHit>): SubtitleHit => ({
  fileId: 1,
  language: 'zh-cn',
  downloads: 0,
  hashMatch: false,
  machine: false,
  hearingImpaired: false,
  trusted: false,
  release: '',
  ...patch,
})

describe('挑字幕与存放', () => {
  it('哈希命中优先，其次简体、下载量；不要机翻', () => {
    expect(
      pickSubtitle([
        hit({ fileId: 1, downloads: 9000 }),
        hit({ fileId: 2, language: 'zh-tw', hashMatch: true }),
        hit({ fileId: 3, machine: true, hashMatch: true }),
      ])?.fileId
    ).toBe(2)
    expect(
      pickSubtitle([
        hit({ fileId: 1, language: 'zh-tw', downloads: 100 }),
        hit({ fileId: 2, downloads: 10 }),
      ])?.fileId
    ).toBe(2)
    expect(pickSubtitle([hit({ language: 'en' })])).toBeNull()
  })

  it('Kodi / Jellyfin 命名', () => {
    expect(subtitleFileName('/m/Dune (2021).mkv', 'zh-cn')).toBe(
      'Dune (2021).zh.srt'
    )
    expect(subtitleFileName('/m/Dune (2021).mkv', 'zh-tw')).toBe(
      'Dune (2021).zh-TW.srt'
    )
  })

  it('再试三次：1 小时、6 小时、1 天，之后放弃', () => {
    expect(nextRetry(1, 0)).toBe(3_600_000)
    expect(nextRetry(3, 0)).toBe(86_400_000)
    expect(nextRetry(4, 0)).toBeNull()
  })
})

describe('OpenSubtitles 参数与响应', () => {
  it('集按剧的 TMDB id + 季集，参数排好序', () => {
    expect(
      searchParams({
        parentTmdbId: '95396',
        season: 1,
        episode: 2,
        moviehash: 'abcd',
      })
    ).toBe(
      'episode_number=2&languages=zh-cn%2Czh-tw&moviehash=abcd&parent_tmdb_id=95396&season_number=1'
    )
  })

  it('取 file_id 与挑选要用的字段', () => {
    expect(
      hitsFromBody({
        data: [
          {
            attributes: {
              language: 'zh-CN',
              download_count: 12,
              moviehash_match: true,
              ai_translated: true,
              files: [{ file_id: 77 }],
            },
          },
          { attributes: { language: 'zh-cn', files: [] } },
        ],
      })
    ).toEqual([
      {
        fileId: 77,
        language: 'zh-cn',
        downloads: 12,
        hashMatch: true,
        machine: true,
        hearingImpaired: false,
        trusted: false,
        release: '',
      },
    ])
  })
})
