/**
 * 规则批量生成黄金用例。
 *
 * 期望值完全由目录数据和模板推出，不调用任何解析器；随机数用固定种子，输出可复现。
 */
import {
  type CatalogAnime,
  type CatalogMovie,
  type CatalogShow,
  anime,
  dailyShows,
  movies,
  shows,
} from './catalog'
import type { GoldenCase, GoldenCategory, GoldenExpected } from './types'

/** mulberry32：固定种子的小型伪随机数发生器。 */
function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RESOLUTIONS = ['2160p', '1080p', '720p', '480p', '4K', '1080i', 'UHD']
const SOURCES = [
  'BluRay',
  'WEB-DL',
  'WEBRip',
  'HDTV',
  'BDRip',
  'REMUX',
  'Blu-ray',
  'WEB',
  'DVDRip',
  'HDRip',
]
const CODECS = [
  'x264',
  'x265',
  'H.264',
  'H.265',
  'HEVC',
  'AVC',
  'AV1',
  'H264',
  'h265',
  '10bit',
]
const AUDIO = [
  'DDP5.1',
  'DTS-HD.MA.5.1',
  'TrueHD.7.1.Atmos',
  'AAC2.0',
  'FLAC',
  'AC3',
  'EAC3',
  'DTS',
  'DD5.1',
  'Atmos',
  'AAC',
]
const HDR = ['HDR', 'HDR10', 'HDR10+', 'DV', 'DoVi', 'HLG', 'SDR']
const STREAMING = [
  'NF',
  'AMZN',
  'DSNP',
  'ATVP',
  'HMAX',
  'iT',
  'MAX',
  'HULU',
  'PCOK',
]
const EDITIONS = [
  'EXTENDED',
  'REPACK',
  'PROPER',
  'REMASTERED',
  'UNRATED',
  'IMAX',
  'Directors.Cut',
  'Criterion',
  'LIMITED',
]
const GROUPS = [
  'HHWEB',
  'CMCT',
  'FGT',
  'SPARKS',
  'RARBG',
  'FraMeSToR',
  'NTb',
  'WiKi',
  'beAst',
  'CHD',
  'FRDS',
  'MTeam',
  'TJUPT',
  'YTS',
]
const CJK_TAGS = [
  '国语中字',
  '中英双字',
  '国粤双语',
  '中文字幕',
  '简繁英字幕',
  '内封中字',
  '无删减',
  '国英双语',
]
const ANIME_GROUPS = [
  'SubsPlease',
  'Erai-raws',
  'HorribleSubs',
  'Judas',
  'ASW',
  'Ohys-Raws',
  'LoliHouse',
  'NC-Raws',
]
const CN_ANIME_GROUPS = [
  '桜都字幕组',
  '喵萌奶茶屋',
  '北宇治字幕组',
  '幻樱字幕组',
  '诸神字幕组',
  '千夏字幕组',
  '豌豆字幕组',
]
const EPISODE_TITLES = [
  'Pilot',
  'The Beginning',
  'Homecoming',
  'Finale',
  'Episode Title',
  'Winter Is Coming',
]
const MOVIE_ROOTS = [
  '/media/Movies',
  'D:\\Movies',
  '/Volumes/NAS/电影',
  '/mnt/nas/video/movies',
]
const TV_ROOTS = [
  '/media/TV',
  'E:\\TV Shows',
  '/Volumes/NAS/电视剧',
  '/mnt/nas/video/tv',
]
const ANIME_ROOTS = ['/media/Anime', 'F:\\动画']

/** 生成全部规则用例。 */
export function generateGoldenCases(): GoldenCase[] {
  const rng = createRng(20261020)
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rng() * items.length)]
  const chance = (p: number): boolean => rng() < p
  const int = (min: number, max: number): number =>
    min + Math.floor(rng() * (max - min + 1))
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const dots = (s: string): string => s.replace(/ /g, '.')
  const hash = (): string =>
    Array.from({ length: 8 }, () => '0123456789ABCDEF'[int(0, 15)]).join('')

  /** 拼路径：按根目录风格选分隔符。 */
  const join = (root: string, ...parts: string[]): string => {
    const sep = root.includes('\\') ? '\\' : '/'
    return [root, ...parts].join(sep)
  }

  /** 生成一段发布信息尾巴（分辨率、来源、编码、音轨、HDR、流媒体、组名）。 */
  const releaseTail = (sep = '.'): string => {
    const parts: string[] = []
    if (chance(0.15)) parts.push(pick(EDITIONS))
    parts.push(pick(RESOLUTIONS))
    if (chance(0.35)) parts.push(pick(STREAMING))
    parts.push(pick(SOURCES))
    if (chance(0.3)) parts.push(pick(HDR))
    parts.push(pick(CODECS))
    if (chance(0.6)) parts.push(pick(AUDIO))
    const body = parts.join(sep)
    return chance(0.85) ? `${body}-${pick(GROUPS)}` : body
  }

  const out: GoldenCase[] = []
  const add = (
    path: string,
    category: GoldenCategory,
    expected: GoldenExpected
  ): void => {
    out.push({ path, category, expected, hand: false })
  }

  const hasCjk = (s: string): boolean => /[\u4e00-\u9fff]/.test(s)
  /** 片名结尾是数字或 Part N 时，无年份的文件名本身就有歧义，不生成。 */
  const yearlessSafe = (title: string): boolean => !/(\d|Part \w+)$/.test(title)

  movies.forEach((m: CatalogMovie, i: number) => {
    const root = pick(MOVIE_ROOTS)
    const { cn, en, year } = m
    const tmdb = String(10000 + i * 37)
    const imdb = `tt${String(1000000 + i * 1373).padStart(7, '0')}`
    const scene = `${dots(en)}.${year}.${releaseTail()}`

    // 场景发布名
    add(join(root, `${scene}.mkv`), 'movie-scene', {
      type: 'movie',
      title: en,
      year,
    })
    add(join(root, scene, `${scene}.mkv`), 'movie-scene', {
      type: 'movie',
      title: en,
      year,
    })
    add(
      join(root, `${en.replace(/ /g, '_')}_${year}_${pick(RESOLUTIONS)}.mkv`),
      'movie-scene',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    add(
      join(
        root,
        `${en} ${year} ${pick(RESOLUTIONS)} ${pick(SOURCES)} ${pick(CODECS)}.mkv`
      ),
      'movie-scene',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    if (yearlessSafe(en)) {
      add(join(root, `${dots(en)}.${releaseTail()}.mkv`), 'movie-scene', {
        type: 'movie',
        title: en,
      })
    }

    // 中英双标题与纯中文
    if (hasCjk(cn)) {
      add(
        join(root, `${cn}.${dots(en)}.${year}.${releaseTail()}.mkv`),
        'movie-dual-title',
        {
          type: 'movie',
          title: cn,
          altTitle: en,
          year,
        }
      )
      add(
        join(
          root,
          `[${cn}].${dots(en)}.${year}.${pick(RESOLUTIONS)}.${pick(SOURCES)}-${pick(GROUPS)}.mkv`
        ),
        'movie-dual-title',
        {
          type: 'movie',
          title: cn,
          altTitle: en,
          year,
        }
      )
      add(
        join(root, `${cn} ${en} (${year}) ${pick(RESOLUTIONS)}.mp4`),
        'movie-dual-title',
        {
          type: 'movie',
          title: cn,
          altTitle: en,
          year,
        }
      )
      add(
        join(
          root,
          `${cn}.${year}.${pick(RESOLUTIONS)}.${pick(SOURCES)}.${pick(CODECS)}.mkv`
        ),
        'movie-cjk',
        {
          type: 'movie',
          title: cn,
          year,
        }
      )
      add(join(root, `${cn}(${year}).mp4`), 'movie-cjk', {
        type: 'movie',
        title: cn,
        year,
      })
      add(
        join(root, `${cn}.${year}.${pick(CJK_TAGS)}.${pick(RESOLUTIONS)}.mp4`),
        'movie-cjk',
        {
          type: 'movie',
          title: cn,
          year,
        }
      )
      add(join(root, `${cn}【${year}】.mkv`), 'movie-cjk', {
        type: 'movie',
        title: cn,
        year,
      })
    }

    // 括号年份 / 规范目录
    add(
      join(root, `${en} (${year})`, `${en} (${year}).mkv`),
      'movie-bracket-year',
      { type: 'movie', title: en, year }
    )
    add(
      join(root, `${en} [${year}] ${pick(RESOLUTIONS)}.mkv`),
      'movie-bracket-year',
      { type: 'movie', title: en, year }
    )
    add(
      join(
        root,
        `${dots(en)}.(${year}).${pick(RESOLUTIONS)}.${pick(SOURCES)}.mkv`
      ),
      'movie-bracket-year',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    add(join(root, `${en} (${year})`, `${en}.mkv`), 'movie-bracket-year', {
      type: 'movie',
      title: en,
      year,
    })

    // 通用文件名回退到文件夹名
    add(
      join(
        root,
        scene,
        pick(['movie.mkv', 'film.mkv', 'video.mp4', 'Movie.mkv'])
      ),
      'movie-folder-fallback',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    add(
      join(
        root,
        `${en} (${year})`,
        pick(['movie.mp4', 'film.avi', 'main.mkv', 'feature.mkv'])
      ),
      'movie-folder-fallback',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    if (hasCjk(cn)) {
      add(join(root, `${cn} (${year})`, 'video.mkv'), 'movie-folder-fallback', {
        type: 'movie',
        title: cn,
        year,
      })
    }

    // 光盘结构
    add(
      join(
        root,
        `${en} (${year})`,
        'VIDEO_TS',
        pick(['VTS_01_1.VOB', 'VIDEO_TS.VOB', 'VTS_02_1.VOB'])
      ),
      'movie-disc',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    add(
      join(
        root,
        `${en} (${year})`,
        'BDMV',
        'STREAM',
        `${pad(int(0, 999), 5)}.m2ts`
      ),
      'movie-disc',
      {
        type: 'movie',
        title: en,
        year,
      }
    )
    add(
      join(
        root,
        `${dots(en)}.${year}.COMPLETE.BLURAY-${pick(GROUPS)}`,
        'BDMV',
        'STREAM',
        '00800.m2ts'
      ),
      'movie-disc',
      {
        type: 'movie',
        title: en,
        year,
      }
    )

    // 分段
    const part = int(1, 3)
    add(
      join(root, `${dots(en)}.${year}.${pick(RESOLUTIONS)}.CD${part}.avi`),
      'movie-part',
      { type: 'movie', title: en, year, part }
    )
    add(join(root, `${en} (${year})`, `CD${part}.avi`), 'movie-part', {
      type: 'movie',
      title: en,
      year,
      part,
    })
    add(
      join(
        root,
        `${en} (${year})`,
        `${en} (${year})-${pick(['part', 'pt', 'cd', 'disc', 'disk', 'dvd'])}${part}.mkv`
      ),
      'movie-part',
      {
        type: 'movie',
        title: en,
        year,
        part,
      }
    )
    add(
      join(root, `${en} (${year})`, `${en} (${year}) - Part ${part}.mkv`),
      'movie-part',
      { type: 'movie', title: en, year, part }
    )

    // 文件名 / 文件夹中的外部 ID
    add(
      join(
        root,
        `${en} (${year}) [tmdbid-${tmdb}]`,
        `${en} (${year}) [tmdbid-${tmdb}].mkv`
      ),
      'movie-ids',
      {
        type: 'movie',
        title: en,
        year,
        ids: { tmdb },
      }
    )
    add(join(root, `${en} (${year}) {tmdb-${tmdb}}.mkv`), 'movie-ids', {
      type: 'movie',
      title: en,
      year,
      ids: { tmdb },
    })
    add(
      join(root, `${en} (${year}) [imdbid-${imdb}]`, `${en}.mkv`),
      'movie-ids',
      { type: 'movie', title: en, year, ids: { imdb } }
    )
    add(
      join(root, `${dots(en)}.${year}.${imdb}.${pick(RESOLUTIONS)}.mkv`),
      'movie-ids',
      { type: 'movie', title: en, year, ids: { imdb } }
    )
    add(
      join(root, `${en} (${year}) {imdb-${imdb}} {tmdb-${tmdb}}.mkv`),
      'movie-ids',
      {
        type: 'movie',
        title: en,
        year,
        ids: { imdb, tmdb },
      }
    )

    // 附加内容
    add(
      join(root, scene, 'Sample', `${scene.toLowerCase()}.sample.mkv`),
      'extra',
      { type: 'extra', title: en, year }
    )
    add(join(root, `${en} (${year})`, `${en} (${year})-trailer.mkv`), 'extra', {
      type: 'extra',
      title: en,
      year,
    })
    add(
      join(
        root,
        `${en} (${year})`,
        pick([
          'Featurettes',
          'Extras',
          'Behind The Scenes',
          'Deleted Scenes',
          'Trailers',
          'Interviews',
          '花絮',
        ]),
        pick([
          'Making Of.mkv',
          'Deleted Scene 1.mkv',
          'Teaser.mkv',
          '幕后制作.mp4',
        ])
      ),
      'extra',
      { type: 'extra', title: en, year }
    )
    add(
      join(
        root,
        `${dots(en)}.${year}.${pick(RESOLUTIONS)}.${pick(SOURCES)}-sample.mkv`
      ),
      'extra',
      { type: 'extra', title: en, year }
    )
  })

  shows.forEach((s: CatalogShow, i: number) => {
    const root = pick(TV_ROOTS)
    const { cn, en, year } = s
    const season = int(1, s.seasons)
    const ep = int(1, 22)
    const ss = pad(season)
    const ee = pad(ep)
    const tvdb = String(70000 + i * 53)
    const tmdb = String(1400 + i * 41)
    const episode = (extra: Partial<GoldenExpected> = {}): GoldenExpected => ({
      type: 'episode',
      title: en,
      season,
      episodes: [ep],
      ...extra,
    })

    // SxxEyy
    add(
      join(
        root,
        en,
        `Season ${season}`,
        `${dots(en)}.S${ss}E${ee}.${releaseTail()}.mkv`
      ),
      'episode-sxxexx',
      episode()
    )
    add(
      join(
        root,
        `${en} (${year})`,
        `Season ${season}`,
        `${dots(en)}.S${ss}E${ee}.${pick(RESOLUTIONS)}.mkv`
      ),
      'episode-sxxexx',
      episode({ year })
    )
    add(
      join(
        root,
        en,
        `${dots(en).toLowerCase()}.s${ss}e${ee}.${pick(RESOLUTIONS)}.mkv`
      ),
      'episode-sxxexx',
      episode({ title: en.toLowerCase() })
    )
    add(
      join(root, en, `${en} - S${ss}E${ee} - ${pick(EPISODE_TITLES)}.mkv`),
      'episode-sxxexx',
      episode()
    )
    add(
      join(root, cn, `S${ss}`, `${cn}.S${ss}E${ee}.${pick(RESOLUTIONS)}.mp4`),
      'episode-sxxexx',
      episode({ title: cn })
    )
    add(
      join(root, cn, `${cn}.${dots(en)}.S${ss}E${ee}.${releaseTail()}.mkv`),
      'episode-sxxexx',
      episode({ title: cn, altTitle: en })
    )
    add(
      join(
        root,
        en,
        `${dots(en)}.${year}.S${ss}E${ee}.${pick(RESOLUTIONS)}.${pick(SOURCES)}.mkv`
      ),
      'episode-sxxexx',
      episode({ year })
    )

    // 多集
    add(
      join(
        root,
        en,
        `Season ${season}`,
        `${dots(en)}.S${ss}E${ee}-E${pad(ep + 2)}.${pick(RESOLUTIONS)}.mkv`
      ),
      'episode-multi',
      episode({ episodes: [ep, ep + 1, ep + 2] })
    )
    add(
      join(
        root,
        en,
        `Season ${season}`,
        `${dots(en)}.S${ss}E${ee}E${pad(ep + 1)}.${pick(RESOLUTIONS)}.mkv`
      ),
      'episode-multi',
      episode({ episodes: [ep, ep + 1] })
    )
    add(
      join(
        root,
        en,
        `Season ${season}`,
        `${en} S${ss}E${ee}-${pad(ep + 1)}.mkv`
      ),
      'episode-multi',
      episode({ episodes: [ep, ep + 1] })
    )

    // 1x01
    add(
      join(root, en, `Season ${season}`, `${en} ${season}x${ee}.mkv`),
      'episode-1x01',
      episode()
    )
    add(
      join(root, en, `${en} - ${season}x${ee} - ${pick(EPISODE_TITLES)}.avi`),
      'episode-1x01',
      episode()
    )

    // 中文季集
    add(
      join(root, cn, `${cn} 第${season}季第${ep}集.mp4`),
      'episode-cjk',
      episode({ title: cn })
    )
    add(join(root, cn, `${cn}.第${ee}集.mp4`), 'episode-cjk', {
      type: 'episode',
      title: cn,
      episodes: [ep],
    })
    add(join(root, cn, `第${ee}集.mp4`), 'episode-cjk', {
      type: 'episode',
      title: cn,
      episodes: [ep],
    })
    add(
      join(root, cn, `${cn}第${ep}集.${pick(RESOLUTIONS)}.mkv`),
      'episode-cjk',
      { type: 'episode', title: cn, episodes: [ep] }
    )
    add(
      join(root, cn, `第${season}季`, `第${ep}集.mp4`),
      'episode-cjk',
      episode({ title: cn })
    )

    // EP / E
    add(
      join(root, cn, `${cn}.EP${ee}.${pick(RESOLUTIONS)}.mp4`),
      'episode-ep',
      { type: 'episode', title: cn, episodes: [ep] }
    )
    add(
      join(root, en, `Season ${season}`, `${en} EP${ee}.mkv`),
      'episode-ep',
      episode()
    )
    add(
      join(root, en, `Season ${season}`, `${en} - E${ee}.mkv`),
      'episode-ep',
      episode()
    )

    // 只靠文件夹的剧名
    add(
      join(root, `${en} (${year})`, `Season ${season}`, `S${ss}E${ee}.mkv`),
      'episode-folder',
      episode({ year })
    )
    add(
      join(root, en, `Season ${ss}`, `${ee}.mkv`),
      'episode-folder',
      episode()
    )
    add(join(root, en, `S${ss}`, `E${ee}.mkv`), 'episode-folder', episode())

    // 特别篇
    const sp = int(1, 5)
    add(
      join(root, en, 'Specials', `${dots(en)}.S00E${pad(sp)}.mkv`),
      'episode-special',
      { type: 'episode', title: en, season: 0, episodes: [sp] }
    )
    add(join(root, en, 'Season 0', `S00E${pad(sp)}.mkv`), 'episode-special', {
      type: 'episode',
      title: en,
      season: 0,
      episodes: [sp],
    })

    // ID
    add(
      join(
        root,
        `${en} (${year}) {tvdb-${tvdb}}`,
        `Season ${season}`,
        `${en} S${ss}E${ee}.mkv`
      ),
      'episode-ids',
      episode({ year, ids: { tvdb } })
    )
    add(
      join(
        root,
        `${en} (${year}) [tmdbid-${tmdb}]`,
        `Season ${season}`,
        `${en} S${ss}E${ee}.mkv`
      ),
      'episode-ids',
      episode({ year, ids: { tmdb } })
    )
    add(
      join(root, `${en} (${year}) [tvdbid-${tvdb}]`, `S${ss}E${ee}.mkv`),
      'episode-ids',
      episode({ year, ids: { tvdb } })
    )

    // 附加内容
    add(
      join(root, en, `Season ${season}`, `${dots(en)}.S${ss}E${ee}.sample.mkv`),
      'extra',
      { type: 'extra', title: en }
    )
    add(
      join(
        root,
        `${en} (${year})`,
        pick(['Extras', 'Featurettes', 'Behind The Scenes']),
        pick(['Bloopers.mkv', 'Inside the Episode.mkv'])
      ),
      'extra',
      {
        type: 'extra',
        title: en,
        year,
      }
    )
  })

  anime.forEach((a: CatalogAnime, i: number) => {
    const root = pick(ANIME_ROOTS)
    const long = ['One Piece', 'Detective Conan', 'Naruto Shippuden'].includes(
      a.romaji
    )
    const ep = long ? int(100, 1120) : int(1, 24)
    const e2 = pad(ep)
    const abs = (title: string, altTitle?: string): GoldenExpected => ({
      type: 'episode',
      title,
      ...(altTitle ? { altTitle } : {}),
      episodes: [ep],
      absolute: true,
    })
    const dir = (name: string): string => join(root, name)
    add(
      join(
        dir(a.romaji),
        `[SubsPlease] ${a.romaji} - ${e2} (1080p) [${hash()}].mkv`
      ),
      'episode-anime-absolute',
      abs(a.romaji)
    )
    add(
      join(
        dir(a.romaji),
        `[Erai-raws] ${a.romaji} - ${e2} [1080p][Multiple Subtitle].mkv`
      ),
      'episode-anime-absolute',
      abs(a.romaji)
    )
    add(
      join(
        dir(a.romaji),
        `[${pick(ANIME_GROUPS)}] ${a.romaji} - ${e2}v2 [720p].mkv`
      ),
      'episode-anime-absolute',
      abs(a.romaji)
    )
    add(
      join(
        dir(a.romaji),
        `[${pick(ANIME_GROUPS)}] ${a.romaji} - ${e2} (BD 1080p HEVC FLAC) [${hash()}].mkv`
      ),
      'episode-anime-absolute',
      abs(a.romaji)
    )
    add(
      join(
        dir(a.cn),
        `[${pick(CN_ANIME_GROUPS)}] ${a.cn} / ${a.romaji} [${e2}][1080P][简繁内封].mkv`
      ),
      'episode-anime-absolute',
      abs(a.cn, a.romaji)
    )
    add(
      join(
        dir(a.cn),
        `[${pick(CN_ANIME_GROUPS)}][${a.cn}][${e2}][1080P][GB][MP4].mp4`
      ),
      'episode-anime-absolute',
      abs(a.cn)
    )
    add(
      join(
        dir(a.cn),
        `【${pick(CN_ANIME_GROUPS)}】★${int(1, 12)}月新番★[${a.cn}][${e2}][1080p][简日双语].mp4`
      ),
      'episode-anime-absolute',
      abs(a.cn)
    )
    add(
      join(
        dir(a.romaji),
        `[ANi] ${a.romaji} - ${e2} [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4`
      ),
      'episode-anime-absolute',
      abs(a.romaji)
    )
    if (i % 2 === 0) {
      add(
        join(dir(a.romaji), `${a.romaji} - ${e2}.mkv`),
        'episode-anime-absolute',
        abs(a.romaji)
      )
    }
  })

  dailyShows.forEach(name => {
    const root = pick(TV_ROOTS)
    for (let k = 0; k < 5; k++) {
      const y = int(2015, 2025)
      const m = pad(int(1, 12))
      const d = pad(int(1, 28))
      const airDate = `${y}-${m}-${d}`
      const expected: GoldenExpected = { type: 'episode', title: name, airDate }
      const templates = [
        `${dots(name)}.${y}.${m}.${d}.${pick(RESOLUTIONS)}.WEB.h264-${pick(GROUPS)}.mkv`,
        `${name} - ${y}-${m}-${d} - Guest Name.mkv`,
        `${name} ${y}-${m}-${d}.mkv`,
        `${dots(name)}.${y}.${m}.${d}.Guest.Name.720p.HDTV.x264-${pick(GROUPS)}.mkv`,
        `${name} ${y}.${m}.${d} ${pick(RESOLUTIONS)}.mp4`,
      ]
      add(join(root, name, templates[k]), 'episode-date', expected)
    }
  })

  return out
}
