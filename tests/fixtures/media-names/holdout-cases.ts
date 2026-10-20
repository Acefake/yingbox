/**
 * 留出集：在解析器调完之后、不看解析结果写下的真实风格命名，用来估计对未见过写法的泛化能力。
 * 这些用例同样计入黄金集，但在基准报告里单独列一行。
 */
import type { GoldenCase, GoldenCategory, GoldenExpected } from './types'

type Row = [path: string, category: GoldenCategory, expected: GoldenExpected]

const rows: Row[] = [
  [
    '/media/Movies/Everything.Everywhere.All.at.Once.2022.1080p.WEB-DL.DDP5.1.H.264-SMURF.mkv',
    'movie-scene',
    { type: 'movie', title: 'Everything Everywhere All at Once', year: 2022 },
  ],
  [
    '/media/Movies/Killers.of.the.Flower.Moon.2023.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
    'movie-scene',
    { type: 'movie', title: 'Killers of the Flower Moon', year: 2023 },
  ],
  [
    '/media/Movies/Poor.Things.2023.1080p.BluRay.x264-SURCODE.mkv',
    'movie-scene',
    { type: 'movie', title: 'Poor Things', year: 2023 },
  ],
  [
    '/media/Movies/The.Holdovers.2023.REPACK.1080p.WEBRip.x265.10bit.AAC5.1-[YTS.MX].mp4',
    'movie-scene',
    { type: 'movie', title: 'The Holdovers', year: 2023 },
  ],
  [
    '/media/Movies/Past Lives (2023) [1080p] [WEBRip] [5.1] [YTS.MX]/Past.Lives.2023.1080p.WEBRip.x264.AAC5.1-[YTS.MX].mp4',
    'movie-scene',
    { type: 'movie', title: 'Past Lives', year: 2023 },
  ],
  [
    '/media/Movies/Anatomy of a Fall (2023)/Anatomy of a Fall (2023) Bluray-1080p.mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'Anatomy of a Fall', year: 2023 },
  ],
  [
    '/media/Movies/The Zone of Interest (2023) [imdbid-tt7160372]/The Zone of Interest (2023) [imdbid-tt7160372] - [Bluray-2160p][DV HDR10][DTS-HD MA 5.1][x265]-GROUP.mkv',
    'movie-ids',
    {
      type: 'movie',
      title: 'The Zone of Interest',
      year: 2023,
      ids: { imdb: 'tt7160372' },
    },
  ],
  [
    '/media/Movies/Godzilla Minus One (2023)/Godzilla.Minus.One.2023.JAPANESE.1080p.BluRay.x264.mkv',
    'movie-scene',
    { type: 'movie', title: 'Godzilla Minus One', year: 2023 },
  ],
  [
    '/media/Movies/The.Boy.and.the.Heron.2023.JAPANESE.2160p.UHD.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'The Boy and the Heron', year: 2023 },
  ],
  [
    '/media/Movies/Perfect.Days.2023.1080p.AMZN.WEB-DL.mkv',
    'movie-scene',
    { type: 'movie', title: 'Perfect Days', year: 2023 },
  ],
  [
    '/media/Movies/封神第一部：朝歌风云.Creation.of.the.Gods.I.Kingdom.of.Storms.2023.2160p.WEB-DL.H265.DV.DDP5.1-ADWeb.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '封神第一部：朝歌风云',
      altTitle: 'Creation of the Gods I Kingdom of Storms',
      year: 2023,
    },
  ],
  [
    '/media/Movies/热辣滚烫.YOLO.2024.2160p.WEB-DL.H265.HDR.DDP5.1-QHstudIo.mkv',
    'movie-dual-title',
    { type: 'movie', title: '热辣滚烫', altTitle: 'YOLO', year: 2024 },
  ],
  [
    '/media/Movies/第二十条.Article.20.2024.1080p.WEB-DL.H264.AAC-OurTV.mp4',
    'movie-dual-title',
    { type: 'movie', title: '第二十条', altTitle: 'Article 20', year: 2024 },
  ],
  [
    '/media/Movies/孤注一掷.No.More.Bets.2023.2160p.WEB-DL.H265.AAC-HHWEB.mkv',
    'movie-dual-title',
    { type: 'movie', title: '孤注一掷', altTitle: 'No More Bets', year: 2023 },
  ],
  [
    '/media/Movies/消失的她.Lost.in.the.Stars.2023.1080p.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '消失的她',
      altTitle: 'Lost in the Stars',
      year: 2023,
    },
  ],
  [
    '/media/Movies/误杀 (2019)/误杀.Sheep.Without.a.Shepherd.2019.1080p.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '误杀',
      altTitle: 'Sheep Without a Shepherd',
      year: 2019,
    },
  ],
  [
    '/media/Movies/铃芽之旅.Suzume.no.Tojimari.2022.JAPANESE.1080p.BluRay.x265-CMCT.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '铃芽之旅',
      altTitle: 'Suzume no Tojimari',
      year: 2022,
    },
  ],
  [
    '/media/Movies/首尔之春.12.12.The.Day.2023.1080p.mkv',
    'movie-dual-title',
    { type: 'movie', title: '首尔之春', altTitle: '12 12 The Day', year: 2023 },
  ],
  [
    '/media/Movies/[飞驰人生2].Pegasus.2.2024.2160p.WEB-DL.H265.mkv',
    'movie-dual-title',
    { type: 'movie', title: '飞驰人生2', altTitle: 'Pegasus 2', year: 2024 },
  ],
  [
    '/media/Movies/大红包 (2024)/大红包.2024.HD1080P.国语中字.mp4',
    'movie-cjk',
    { type: 'movie', title: '大红包', year: 2024 },
  ],
  [
    '/media/Movies/周处除三害.2023.1080p.NF.WEB-DL.mkv',
    'movie-cjk',
    { type: 'movie', title: '周处除三害', year: 2023 },
  ],
  [
    '/media/Movies/默杀.2024.HD1080P.X264.AAC.Mandarin.CHS.mp4',
    'movie-cjk',
    { type: 'movie', title: '默杀', year: 2024 },
  ],
  [
    '/media/Movies/The Thing (1982)/The.Thing.1982.Collectors.Edition.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'The Thing', year: 1982 },
  ],
  [
    '/media/Movies/Aliens (1986)/Aliens.1986.Special.Edition.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'Aliens', year: 1986 },
  ],
  [
    '/media/Movies/Blade Runner (1982)/Blade.Runner.1982.The.Final.Cut.2160p.UHD.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'Blade Runner', year: 1982 },
  ],
  [
    '/media/Movies/Kill Bill Vol. 1 (2003)/Kill Bill Vol. 1 (2003).mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'Kill Bill Vol 1', year: 2003 },
  ],
  [
    '/media/Movies/Star Wars Episode IV - A New Hope (1977)/Star Wars Episode IV - A New Hope (1977).mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'Star Wars Episode IV - A New Hope', year: 1977 },
  ],
  [
    '/media/Movies/E.T. the Extra-Terrestrial (1982)/E.T. the Extra-Terrestrial (1982).mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'E T the Extra-Terrestrial', year: 1982 },
  ],
  [
    '/media/Movies/Fast & Furious 6 (2013)/Fast & Furious 6 (2013).mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'Fast & Furious 6', year: 2013 },
  ],
  [
    '/media/Movies/Mission Impossible - Dead Reckoning Part One (2023)/Mission Impossible - Dead Reckoning Part One (2023).mkv',
    'movie-bracket-year',
    {
      type: 'movie',
      title: 'Mission Impossible - Dead Reckoning Part One',
      year: 2023,
    },
  ],
  [
    '/media/Movies/Ghost in the Shell (1995)/ghost-in-the-shell-1995-1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'ghost in the shell', year: 1995 },
  ],
  [
    '/media/Movies/Akira (1988)/Akira (1988) Remastered 1080p.mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'Akira', year: 1988 },
  ],
  [
    '/media/Movies/Seven Samurai (1954)/Disc 2/VIDEO_TS/VTS_01_2.VOB',
    'movie-disc',
    { type: 'movie', title: 'Seven Samurai', year: 1954, part: 2 },
  ],
  [
    '/media/Movies/Lawrence of Arabia (1962)/Lawrence of Arabia (1962)-cd2.avi',
    'movie-part',
    { type: 'movie', title: 'Lawrence of Arabia', year: 1962, part: 2 },
  ],
  [
    '/media/Movies/Gone with the Wind (1939)/Gone.with.the.Wind.1939.DVDRip.XviD-CD1.avi',
    'movie-part',
    { type: 'movie', title: 'Gone with the Wind', year: 1939, part: 1 },
  ],
  [
    '/media/Movies/Ran (1985) {tmdb-11645}/Ran (1985) {tmdb-11645}.mkv',
    'movie-ids',
    { type: 'movie', title: 'Ran', year: 1985, ids: { tmdb: '11645' } },
  ],
  [
    '/media/Movies/Heat (1995)/Heat (1995) - Behind the Scenes.mkv',
    'extra',
    { type: 'extra', title: 'Heat', year: 1995 },
  ],
  [
    '/media/Movies/Heat (1995)/Behind The Scenes/Making Heat.mkv',
    'extra',
    { type: 'extra', title: 'Heat', year: 1995 },
  ],
  [
    '/media/Movies/Arrival (2016)/Arrival (2016)-deleted.mkv',
    'extra',
    { type: 'extra', title: 'Arrival', year: 2016 },
  ],
  [
    '/media/Movies/Arrival (2016)/Shorts/Eleven Ounces.mkv',
    'extra',
    { type: 'extra', title: 'Arrival', year: 2016 },
  ],
  [
    '/media/Movies/Tenet.2020.IMAX.1080p.BluRay.x264-SAMPLE/tenet.2020.imax.1080p-sample.mkv',
    'extra',
    { type: 'extra', title: 'tenet', year: 2020 },
  ],

  [
    '/media/TV/Shogun (2024)/Season 1/Shogun.2024.S01E01.Anjin.1080p.DSNP.WEB-DL.DDP5.1.H.264-NTb.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Shogun', year: 2024, season: 1, episodes: [1] },
  ],
  [
    '/media/TV/Fallout/Season 1/Fallout.S01.E01.The.End.2160p.AMZN.WEB-DL.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Fallout', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/House of the Dragon/Season 2/House.of.the.Dragon.S02E08.1080p.WEB.H264-SuccessfulCrab[TGx].mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'House of the Dragon', season: 2, episodes: [8] },
  ],
  [
    '/media/TV/The Last of Us (2023)/Season 01/The Last of Us - S01E09 - Look for the Light WEBDL-2160p.mkv',
    'episode-sxxexx',
    {
      type: 'episode',
      title: 'The Last of Us',
      year: 2023,
      season: 1,
      episodes: [9],
    },
  ],
  [
    '/media/TV/Andor/Season 1/Andor.S01E01-E03.2160p.mkv',
    'episode-multi',
    { type: 'episode', title: 'Andor', season: 1, episodes: [1, 2, 3] },
  ],
  [
    '/media/TV/Seinfeld/Season 9/Seinfeld - S09E23-E24 - The Finale.mkv',
    'episode-multi',
    { type: 'episode', title: 'Seinfeld', season: 9, episodes: [23, 24] },
  ],
  [
    '/media/TV/The Simpsons/Season 35/The Simpsons - 35x01 - Homer s Adventures.mkv',
    'episode-1x01',
    { type: 'episode', title: 'The Simpsons', season: 35, episodes: [1] },
  ],
  [
    '/media/TV/Top Gear/Season 22/top.gear.22x03.hdtv.x264.mp4',
    'episode-1x01',
    { type: 'episode', title: 'top gear', season: 22, episodes: [3] },
  ],
  [
    '/media/TV/Planet Earth II/Planet Earth II S01E01 Islands 2160p UHD BluRay.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Planet Earth II', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/繁花/Season 1/繁花.Blossoms.Shanghai.S01E05.2023.2160p.WEB-DL.H265.DDP5.1-ADWeb.mkv',
    'episode-cjk',
    {
      type: 'episode',
      title: '繁花',
      altTitle: 'Blossoms Shanghai',
      season: 1,
      episodes: [5],
    },
  ],
  [
    '/media/TV/长相思/长相思.第二季.第08集.4K.mp4',
    'episode-cjk',
    { type: 'episode', title: '长相思', season: 2, episodes: [8] },
  ],
  [
    '/media/TV/玫瑰的故事/玫瑰的故事 第38集 4K.mp4',
    'episode-cjk',
    { type: 'episode', title: '玫瑰的故事', episodes: [38] },
  ],
  [
    '/media/TV/墨雨云间/墨雨云间-EP12.mp4',
    'episode-ep',
    { type: 'episode', title: '墨雨云间', episodes: [12] },
  ],
  [
    '/media/TV/庆余年/第二季/12.mp4',
    'episode-folder',
    { type: 'episode', title: '庆余年', season: 2, episodes: [12] },
  ],
  [
    '/media/TV/甄嬛传/Season 1/甄嬛传.E15.1080p.mp4',
    'episode-ep',
    { type: 'episode', title: '甄嬛传', season: 1, episodes: [15] },
  ],
  [
    '/media/TV/The Crown/Season 1/1x03.mkv',
    'episode-folder',
    { type: 'episode', title: 'The Crown', season: 1, episodes: [3] },
  ],
  [
    '/media/TV/Friends (1994)/Season 03/S03E25.mkv',
    'episode-folder',
    {
      type: 'episode',
      title: 'Friends',
      year: 1994,
      season: 3,
      episodes: [25],
    },
  ],
  [
    '/media/TV/Doctor Who (2005)/Season 0/Doctor.Who.2005.S00E14.The.Day.of.the.Doctor.mkv',
    'episode-special',
    {
      type: 'episode',
      title: 'Doctor Who',
      year: 2005,
      season: 0,
      episodes: [14],
    },
  ],
  [
    '/media/TV/Last Week Tonight with John Oliver/Last.Week.Tonight.With.John.Oliver.2024.06.16.1080p.WEB.h264-EDITH.mkv',
    'episode-date',
    {
      type: 'episode',
      title: 'Last Week Tonight With John Oliver',
      airDate: '2024-06-16',
    },
  ],
  [
    '/media/TV/Saturday Night Live/Saturday.Night.Live.2024.10.05.Nate.Bargatze.720p.mkv',
    'episode-date',
    { type: 'episode', title: 'Saturday Night Live', airDate: '2024-10-05' },
  ],
  [
    '/media/TV/新闻联播/新闻联播.20241020.mp4',
    'episode-date',
    { type: 'episode', title: '新闻联播', airDate: '2024-10-20' },
  ],
  [
    '/media/TV/The Bear (2022) [tvdbid-410153]/Season 3/The Bear (2022) - S03E01 - Tomorrow.mkv',
    'episode-ids',
    {
      type: 'episode',
      title: 'The Bear',
      year: 2022,
      season: 3,
      episodes: [1],
      ids: { tvdb: '410153' },
    },
  ],
  [
    '/media/TV/Severance {tmdb-95396}/Season 2/Severance - S02E10.mkv',
    'episode-ids',
    {
      type: 'episode',
      title: 'Severance',
      season: 2,
      episodes: [10],
      ids: { tmdb: '95396' },
    },
  ],

  [
    '/media/Anime/Dandadan/[SubsPlease] Dandadan - 01 (1080p) [B1D1D1AA].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Dandadan', episodes: [1], absolute: true },
  ],
  [
    '/media/Anime/Frieren/[Erai-raws] Sousou no Frieren - 28 END [1080p][Multiple Subtitle][9C0F4E2A].mkv',
    'episode-anime-absolute',
    {
      type: 'episode',
      title: 'Sousou no Frieren',
      episodes: [28],
      absolute: true,
    },
  ],
  [
    '/media/Anime/Mushoku Tensei/[ASW] Mushoku Tensei S2 - 12 [1080p HEVC][5E1AA5B1].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Mushoku Tensei', season: 2, episodes: [12] },
  ],
  [
    '/media/Anime/Re Zero/[Judas] Re Zero kara Hajimeru Isekai Seikatsu - S03E05.mkv',
    'episode-sxxexx',
    {
      type: 'episode',
      title: 'Re Zero kara Hajimeru Isekai Seikatsu',
      season: 3,
      episodes: [5],
    },
  ],
  [
    '/media/Anime/Made in Abyss/[LoliHouse] Made in Abyss - 01 [BDRip 1080p HEVC-10bit FLAC].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Made in Abyss', episodes: [1], absolute: true },
  ],
  [
    '/media/Anime/鬼灭之刃/[DBD-Raws][鬼灭之刃][01][1080P][BDRip][HEVC-10bit][FLAC].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: '鬼灭之刃', episodes: [1], absolute: true },
  ],
  [
    '/media/Anime/轻音少女/[VCB-Studio] K-ON! [01][Ma10p_1080p][x265_flac].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'K-ON!', episodes: [1], absolute: true },
  ],
  [
    '/media/Anime/命运石之门/[Nekomoe kissaten&VCB-Studio] Steins;Gate [12][Ma10p_1080p][x265_flac].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Steins;Gate', episodes: [12], absolute: true },
  ],
  [
    '/media/Anime/间谍过家家/[ANi] SPY×FAMILY 間諜家家酒 - 37 [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4',
    'episode-anime-absolute',
    {
      type: 'episode',
      title: '間諜家家酒',
      altTitle: 'SPY×FAMILY',
      episodes: [37],
      absolute: true,
    },
  ],
  [
    '/media/Anime/One Piece/One Piece - 1110.mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'One Piece', episodes: [1110], absolute: true },
  ],
]

/** 留出集用例。 */
export const holdoutCases: GoldenCase[] = rows.map(
  ([path, category, expected]) => ({
    path,
    category,
    expected,
    hand: true,
  })
)
