/**
 * 手写难例：规则生成覆盖不到、或在真实媒体库里反复出错的命名。
 */
import type { GoldenCase, GoldenCategory, GoldenExpected } from './types'

type Row = [path: string, category: GoldenCategory, expected: GoldenExpected]

const rows: Row[] = [
  // —— 中英双标题 ——
  [
    '/media/Movies/流浪地球.The.Wandering.Earth.2019.2160p.WEB-DL.H265.HDR.DDP5.1-HHWEB.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '流浪地球',
      altTitle: 'The Wandering Earth',
      year: 2019,
    },
  ],
  [
    '/media/Movies/流浪地球2.The.Wandering.Earth.2.2023.2160p.HQ.WEB-DL.H265.60fps.DDP5.1.Atmos-CHDWEB.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '流浪地球2',
      altTitle: 'The Wandering Earth 2',
      year: 2023,
    },
  ],
  [
    '/media/Movies/The.Wandering.Earth.流浪地球.2019.1080p.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '流浪地球',
      altTitle: 'The Wandering Earth',
      year: 2019,
    },
  ],
  [
    '/media/Movies/让子弹飞 Let the Bullets Fly (2010) 国语中字 1080p.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '让子弹飞',
      altTitle: 'Let the Bullets Fly',
      year: 2010,
    },
  ],
  [
    '/media/Movies/霸王別姬.Farewell.My.Concubine.1993.BluRay.1080p.x265.10bit.MNHD-FRDS.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '霸王別姬',
      altTitle: 'Farewell My Concubine',
      year: 1993,
    },
  ],
  [
    '/media/Movies/千と千尋の神隠し.Spirited.Away.2001.1080p.BluRay.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '千と千尋の神隠し',
      altTitle: 'Spirited Away',
      year: 2001,
    },
  ],
  [
    '/media/Movies/기생충.Parasite.2019.1080p.BluRay.x264.mkv',
    'movie-dual-title',
    { type: 'movie', title: '기생충', altTitle: 'Parasite', year: 2019 },
  ],
  [
    '/media/Movies/复仇者联盟4：终局之战.Avengers.Endgame.2019.IMAX.2160p.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '复仇者联盟4：终局之战',
      altTitle: 'Avengers Endgame',
      year: 2019,
    },
  ],
  [
    'D:\\Movies\\【高清影视之家发布 www.HDBTHD.com】长津湖[国语音轨+中文字幕].The.Battle.at.Lake.Changjin.2021.2160p.WEB-DL.H265.mkv',
    'movie-dual-title',
    {
      type: 'movie',
      title: '长津湖',
      altTitle: 'The Battle at Lake Changjin',
      year: 2021,
    },
  ],
  [
    '/media/Movies/阳光电影www.ygdy8.com.我不是药神.HD.1080p.国语中字.mkv',
    'movie-cjk',
    { type: 'movie', title: '我不是药神' },
  ],
  [
    '/media/Movies/[电影天堂www.dytt89.com]满江红-2023_HD国语中字.mp4',
    'movie-cjk',
    { type: 'movie', title: '满江红', year: 2023 },
  ],
  [
    '/media/Movies/哪吒之魔童降世.2019.HD1080P.国语中字.mp4',
    'movie-cjk',
    { type: 'movie', title: '哪吒之魔童降世', year: 2019 },
  ],
  [
    '/media/Movies/你好，李焕英 (2021)/你好，李焕英 (2021).mkv',
    'movie-cjk',
    { type: 'movie', title: '你好，李焕英', year: 2021 },
  ],
  [
    '/media/Movies/無間道.2002.1080p.BluRay.mkv',
    'movie-cjk',
    { type: 'movie', title: '無間道', year: 2002 },
  ],

  // —— 片名里有数字或像年份 ——
  [
    '/media/Movies/1917.2019.1080p.BluRay.x264-SPARKS.mkv',
    'movie-scene',
    { type: 'movie', title: '1917', year: 2019 },
  ],
  [
    '/media/Movies/2012.2009.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: '2012', year: 2009 },
  ],
  [
    '/media/Movies/Blade.Runner.2049.2017.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-EPSiLON.mkv',
    'movie-scene',
    { type: 'movie', title: 'Blade Runner 2049', year: 2017 },
  ],
  [
    '/media/Movies/2001.A.Space.Odyssey.1968.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: '2001 A Space Odyssey', year: 1968 },
  ],
  [
    '/media/Movies/The.Legend.of.1900.1998.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'The Legend of 1900', year: 1998 },
  ],
  [
    '/media/Movies/1917.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: '1917' },
  ],
  [
    '/media/Movies/300 (2006)/300 (2006).mkv',
    'movie-bracket-year',
    { type: 'movie', title: '300', year: 2006 },
  ],
  [
    '/media/Movies/Fantastic.Four.2015.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'Fantastic Four', year: 2015 },
  ],
  [
    '/media/Movies/Mad.Max.Fury.Road.2015.MAX.WEB-DL.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'Mad Max Fury Road', year: 2015 },
  ],
  [
    '/media/Movies/Spider-Man.Into.the.Spider-Verse.2018.1080p.WEB-DL.DD5.1.H264-FGT.mkv',
    'movie-scene',
    { type: 'movie', title: 'Spider-Man Into the Spider-Verse', year: 2018 },
  ],
  [
    '/media/Movies/Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
    'movie-scene',
    { type: 'movie', title: 'Dune Part Two', year: 2024 },
  ],
  [
    '/media/Movies/Harry.Potter.and.the.Deathly.Hallows.Part.1.2010.1080p.BluRay.x264.mkv',
    'movie-scene',
    {
      type: 'movie',
      title: 'Harry Potter and the Deathly Hallows Part 1',
      year: 2010,
    },
  ],
  [
    '/media/Movies/The.Godfather.Part.II.1974.REMASTERED.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'The Godfather Part II', year: 1974 },
  ],
  [
    '/media/Movies/Avatar.The.Way.of.Water.2022.HDR.2160p.WEB.H265-CUPCAKES.mkv',
    'movie-scene',
    { type: 'movie', title: 'Avatar The Way of Water', year: 2022 },
  ],
  [
    '/media/Movies/Oppenheimer.2023.IMAX.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ.mkv',
    'movie-scene',
    { type: 'movie', title: 'Oppenheimer', year: 2023 },
  ],
  [
    '/media/Movies/Top.Gun.Maverick.2022.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-EVO.mkv',
    'movie-scene',
    { type: 'movie', title: 'Top Gun Maverick', year: 2022 },
  ],
  [
    '/media/Movies/the.matrix.1999.720p.mkv',
    'movie-scene',
    { type: 'movie', title: 'the matrix', year: 1999 },
  ],
  [
    '/media/Movies/Inception (2010) 1080p BrRip x264 - YIFY.mp4',
    'movie-bracket-year',
    { type: 'movie', title: 'Inception', year: 2010 },
  ],
  [
    '/media/Movies/Interstellar.2014.1080p.BluRay.x264.DTS-HD.MA.5.1-RARBG/Interstellar.2014.1080p.BluRay.x264.DTS-HD.MA.5.1-RARBG.mkv',
    'movie-scene',
    { type: 'movie', title: 'Interstellar', year: 2014 },
  ],
  [
    '/media/Movies/Alien[1979]DvDrip[Eng]-Stealthmaster.avi',
    'movie-bracket-year',
    { type: 'movie', title: 'Alien', year: 1979 },
  ],
  [
    '/media/Movies/Jaws.1975.40th.Anniversary.Edition.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'Jaws', year: 1975 },
  ],
  [
    '/media/Movies/Leon.The.Professional.1994.Extended.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'Leon The Professional', year: 1994 },
  ],
  [
    '/media/Movies/WALL-E.2008.1080p.mkv',
    'movie-scene',
    { type: 'movie', title: 'WALL-E', year: 2008 },
  ],
  [
    '/media/Movies/Amélie.2001.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'Amélie', year: 2001 },
  ],

  // —— 回退到文件夹 ——
  [
    '/media/Movies/The.Prestige.2006.1080p.BluRay.x264-CiNEFiLE/cinefile-prestige-1080p.mkv',
    'movie-folder-fallback',
    { type: 'movie', title: 'The Prestige', year: 2006 },
  ],
  [
    '/media/Movies/Memento (2000)/memento.mkv',
    'movie-folder-fallback',
    { type: 'movie', title: 'memento', year: 2000 },
  ],
  [
    '/media/Movies/Tenet (2020)/Tenet.mkv',
    'movie-folder-fallback',
    { type: 'movie', title: 'Tenet', year: 2020 },
  ],
  [
    'D:\\Movies\\Heat (1995)\\VIDEO_TS\\VTS_01_1.VOB',
    'movie-disc',
    { type: 'movie', title: 'Heat', year: 1995 },
  ],
  [
    '/media/Movies/Arrival.2016.COMPLETE.UHD.BLURAY-TERMiNAL/BDMV/STREAM/00003.m2ts',
    'movie-disc',
    { type: 'movie', title: 'Arrival', year: 2016 },
  ],
  [
    '/media/Movies/Dunkirk (2017)/Disc 1/BDMV/STREAM/00001.m2ts',
    'movie-disc',
    { type: 'movie', title: 'Dunkirk', year: 2017, part: 1 },
  ],
  [
    '/media/Movies/Home Alone (1990)/CD1/movie.avi',
    'movie-part',
    { type: 'movie', title: 'Home Alone', year: 1990, part: 1 },
  ],
  [
    '/media/Movies/Home Alone (1990)/Home.Alone.1990.DVDRip.XviD.CD2.avi',
    'movie-part',
    { type: 'movie', title: 'Home Alone', year: 1990, part: 2 },
  ],
  [
    '/media/Movies/Avatar.2009.Extended.1080p.BluRay.x264.part2.mkv',
    'movie-part',
    { type: 'movie', title: 'Avatar', year: 2009, part: 2 },
  ],
  [
    '/media/Movies/Titanic (1997)/Titanic (1997) - Disc 2.mkv',
    'movie-part',
    { type: 'movie', title: 'Titanic', year: 1997, part: 2 },
  ],

  // —— ID ——
  [
    '/media/Movies/The Matrix (1999) {tmdb-603}/The Matrix (1999) {tmdb-603} - 1080p.mkv',
    'movie-ids',
    { type: 'movie', title: 'The Matrix', year: 1999, ids: { tmdb: '603' } },
  ],
  [
    '/media/Movies/The Matrix (1999) [tmdbid=603]/movie.mkv',
    'movie-ids',
    { type: 'movie', title: 'The Matrix', year: 1999, ids: { tmdb: '603' } },
  ],
  [
    '/media/Movies/Inception.2010.tt1375666.1080p.BluRay.mkv',
    'movie-ids',
    {
      type: 'movie',
      title: 'Inception',
      year: 2010,
      ids: { imdb: 'tt1375666' },
    },
  ],
  [
    '/media/Movies/Inception (2010) [imdbid-tt1375666]/Inception (2010) [imdbid-tt1375666].mkv',
    'movie-ids',
    {
      type: 'movie',
      title: 'Inception',
      year: 2010,
      ids: { imdb: 'tt1375666' },
    },
  ],
  [
    '/media/Movies/Heat (1995) [imdb-tt0113277].mkv',
    'movie-ids',
    { type: 'movie', title: 'Heat', year: 1995, ids: { imdb: 'tt0113277' } },
  ],
  [
    '/media/Movies/Dune (2021) {imdb-tt1160419} {tmdb-438631}/Dune (2021).mkv',
    'movie-ids',
    {
      type: 'movie',
      title: 'Dune',
      year: 2021,
      ids: { imdb: 'tt1160419', tmdb: '438631' },
    },
  ],
  [
    '/media/Movies/Oppenheimer (2023) [tmdbid-872585]/Oppenheimer (2023) [tmdbid-872585] - IMAX 2160p.mkv',
    'movie-ids',
    {
      type: 'movie',
      title: 'Oppenheimer',
      year: 2023,
      ids: { tmdb: '872585' },
    },
  ],
  [
    '/media/Movies/The Batman (2022) tt1877830.mkv',
    'movie-ids',
    {
      type: 'movie',
      title: 'The Batman',
      year: 2022,
      ids: { imdb: 'tt1877830' },
    },
  ],

  // —— 剧集：SxxEyy 变体 ——
  [
    '/media/TV/Breaking Bad/Season 1/Breaking.Bad.S01E01.Pilot.720p.BluRay.x264.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Breaking Bad', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/Doctor Who (2005)/Season 1/Doctor.Who.2005.S01E01.Rose.mkv',
    'episode-sxxexx',
    {
      type: 'episode',
      title: 'Doctor Who',
      year: 2005,
      season: 1,
      episodes: [1],
    },
  ],
  [
    '/media/TV/The Office (US)/Season 2/The.Office.US.S02E01.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'The Office US', season: 2, episodes: [1] },
  ],
  [
    '/media/TV/24/Season 3/24.S03E05.mkv',
    'episode-sxxexx',
    { type: 'episode', title: '24', season: 3, episodes: [5] },
  ],
  [
    '/media/TV/Game of Thrones/S08/Game.of.Thrones.S08E06.The.Iron.Throne.1080p.AMZN.WEB-DL.DDP5.1.H.264-GoT.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Game of Thrones', season: 8, episodes: [6] },
  ],
  [
    '/media/TV/Friends/Season 10/Friends - S10E17 - The Last One (1).mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Friends', season: 10, episodes: [17] },
  ],
  [
    '/media/TV/Lost/Season 1/lost.s01e01.720p.bluray.x264-reward.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'lost', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/The Mandalorian/Season 1/The.Mandalorian.S01E01.Chapter.1.2160p.DSNP.WEB-DL.DDP5.1.Atmos.HDR.HEVC-MZABI.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'The Mandalorian', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/9-1-1/Season 1/9-1-1.S01E01.mkv',
    'episode-sxxexx',
    { type: 'episode', title: '9-1-1', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/Westworld/Season 1/Westworld S01 E03.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Westworld', season: 1, episodes: [3] },
  ],
  [
    '/media/TV/Dark/Season 1/Dark.S1E2.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Dark', season: 1, episodes: [2] },
  ],
  [
    '/media/TV/Columbo/Season 10/Columbo.S10E01.1080p.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Columbo', season: 10, episodes: [1] },
  ],
  [
    '/media/TV/Lost/Season 1/Lost.S01E01-02.Pilot.mkv',
    'episode-multi',
    { type: 'episode', title: 'Lost', season: 1, episodes: [1, 2] },
  ],
  [
    '/media/TV/Lost/Season 1/Lost.S01E01-E02-E03.mkv',
    'episode-multi',
    { type: 'episode', title: 'Lost', season: 1, episodes: [1, 2, 3] },
  ],
  [
    '/media/TV/The Office (US)/Season 3/The.Office.US.S03E10E11.mkv',
    'episode-multi',
    { type: 'episode', title: 'The Office US', season: 3, episodes: [10, 11] },
  ],
  [
    '/media/TV/Sherlock/Season 1/Sherlock 1x01-1x02.mkv',
    'episode-multi',
    { type: 'episode', title: 'Sherlock', season: 1, episodes: [1, 2] },
  ],
  [
    '/media/TV/Friends/Season 1/Friends 1x01.avi',
    'episode-1x01',
    { type: 'episode', title: 'Friends', season: 1, episodes: [1] },
  ],
  [
    '/media/TV/Friends/Season 10/Friends 10x17.avi',
    'episode-1x01',
    { type: 'episode', title: 'Friends', season: 10, episodes: [17] },
  ],

  // —— 剧集：中文 ——
  [
    '/media/TV/权力的游戏/权力的游戏.第1季第3集.mkv',
    'episode-cjk',
    { type: 'episode', title: '权力的游戏', season: 1, episodes: [3] },
  ],
  [
    '/media/TV/狂飙/狂飙.第03集.4K.mp4',
    'episode-cjk',
    { type: 'episode', title: '狂飙', episodes: [3] },
  ],
  [
    '/media/TV/狂飙/第一季/第3集.mp4',
    'episode-cjk',
    { type: 'episode', title: '狂飙', season: 1, episodes: [3] },
  ],
  [
    '/media/TV/繁花/繁花 第十二集.mp4',
    'episode-cjk',
    { type: 'episode', title: '繁花', episodes: [12] },
  ],
  [
    '/media/TV/庆余年/第二季/庆余年第二季 第05集.mp4',
    'episode-cjk',
    { type: 'episode', title: '庆余年', season: 2, episodes: [5] },
  ],
  [
    '/media/TV/甄嬛传/甄嬛传 76.mp4',
    'episode-cjk',
    { type: 'episode', title: '甄嬛传', episodes: [76] },
  ],
  [
    '/media/TV/琅琊榜/琅琊榜-01.mp4',
    'episode-cjk',
    { type: 'episode', title: '琅琊榜', episodes: [1] },
  ],
  [
    '/media/TV/三体/三体.Three-Body.S01E05.2023.2160p.WEB-DL.H265.mkv',
    'episode-cjk',
    {
      type: 'episode',
      title: '三体',
      altTitle: 'Three-Body',
      season: 1,
      episodes: [5],
    },
  ],
  [
    '/media/TV/漫长的季节/漫长的季节.EP01-02.mp4',
    'episode-cjk',
    { type: 'episode', title: '漫长的季节', episodes: [1, 2] },
  ],
  [
    '/media/TV/隐秘的角落/隐秘的角落 第1-2集.mp4',
    'episode-cjk',
    { type: 'episode', title: '隐秘的角落', episodes: [1, 2] },
  ],
  [
    '/media/TV/请回答1988/请回答1988.E05.mp4',
    'episode-ep',
    { type: 'episode', title: '请回答1988', episodes: [5] },
  ],
  [
    '/media/TV/Reply 1988/Season 1/Reply 1988 S01E05.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Reply 1988', season: 1, episodes: [5] },
  ],

  // —— 剧集：只有文件夹 ——
  [
    '/media/TV/The Wire (2002)/Season 3/03.mkv',
    'episode-folder',
    {
      type: 'episode',
      title: 'The Wire',
      year: 2002,
      season: 3,
      episodes: [3],
    },
  ],
  [
    '/media/TV/The Wire/Season 03/Episode 05.mkv',
    'episode-folder',
    { type: 'episode', title: 'The Wire', season: 3, episodes: [5] },
  ],
  [
    '/media/TV/Succession/Season 2/S02E10 - This Is Not for Tears.mkv',
    'episode-folder',
    { type: 'episode', title: 'Succession', season: 2, episodes: [10] },
  ],
  [
    'E:\\TV Shows\\Severance\\Season 2\\Severance.S02E01.1080p.ATVP.WEB-DL.mkv',
    'episode-sxxexx',
    { type: 'episode', title: 'Severance', season: 2, episodes: [1] },
  ],

  // —— 特别篇 ——
  [
    '/media/TV/Sherlock/Specials/Sherlock.S00E01.The.Abominable.Bride.mkv',
    'episode-special',
    { type: 'episode', title: 'Sherlock', season: 0, episodes: [1] },
  ],
  [
    '/media/TV/Doctor Who (2005)/Specials/Doctor Who - S00E05 - The Christmas Invasion.mkv',
    'episode-special',
    {
      type: 'episode',
      title: 'Doctor Who',
      year: 2005,
      season: 0,
      episodes: [5],
    },
  ],

  // —— 日期节目 ——
  [
    '/media/TV/The Daily Show/The.Daily.Show.2024.03.15.Jon.Stewart.720p.WEB.h264-EDITH.mkv',
    'episode-date',
    { type: 'episode', title: 'The Daily Show', airDate: '2024-03-15' },
  ],
  [
    '/media/TV/快乐大本营/快乐大本营.20240315.mp4',
    'episode-date',
    { type: 'episode', title: '快乐大本营', airDate: '2024-03-15' },
  ],
  [
    '/media/TV/新闻联播/新闻联播 2024-03-15.mp4',
    'episode-date',
    { type: 'episode', title: '新闻联播', airDate: '2024-03-15' },
  ],
  [
    '/media/TV/Jeopardy/Jeopardy 2023 11 02.mkv',
    'episode-date',
    { type: 'episode', title: 'Jeopardy', airDate: '2023-11-02' },
  ],

  // —— 动画 ——
  [
    '/media/Anime/One Piece/[SubsPlease] One Piece - 1080 (1080p) [ABCDEF12].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'One Piece', episodes: [1080], absolute: true },
  ],
  [
    '/media/Anime/Frieren/[SubsPlease] Sousou no Frieren - 03 (1080p) [A1B2C3D4].mkv',
    'episode-anime-absolute',
    {
      type: 'episode',
      title: 'Sousou no Frieren',
      episodes: [3],
      absolute: true,
    },
  ],
  [
    '/media/Anime/86/[Judas] 86 - Eighty Six - 05.mkv',
    'episode-anime-absolute',
    {
      type: 'episode',
      title: '86 - Eighty Six',
      episodes: [5],
      absolute: true,
    },
  ],
  [
    '/media/Anime/Steins Gate/[Coalgirls] Steins;Gate 01 (1280x720 Blu-Ray FLAC) [B9A1F2E3].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Steins;Gate', episodes: [1], absolute: true },
  ],
  [
    '/media/Anime/葬送的芙莉莲/[桜都字幕组] 葬送的芙莉莲 / Sousou no Frieren [03][1080P][简繁内封].mkv',
    'episode-anime-absolute',
    {
      type: 'episode',
      title: '葬送的芙莉莲',
      altTitle: 'Sousou no Frieren',
      episodes: [3],
      absolute: true,
    },
  ],
  [
    '/media/Anime/葬送的芙莉莲/【喵萌奶茶屋】★10月新番★[葬送的芙莉莲][03][1080p][简日双语].mp4',
    'episode-anime-absolute',
    { type: 'episode', title: '葬送的芙莉莲', episodes: [3], absolute: true },
  ],
  [
    '/media/Anime/Spy x Family/[LoliHouse] Spy x Family - 12 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Spy x Family', episodes: [12], absolute: true },
  ],
  [
    '/media/Anime/Bocchi the Rock/[Nekomoe kissaten][Bocchi the Rock!][05][1080p][JPSC].mp4',
    'episode-anime-absolute',
    {
      type: 'episode',
      title: 'Bocchi the Rock!',
      episodes: [5],
      absolute: true,
    },
  ],
  [
    '/media/Anime/Kimetsu no Yaiba/Season 1/[Erai-raws] Kimetsu no Yaiba - 19 [1080p].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Kimetsu no Yaiba', season: 1, episodes: [19] },
  ],
  [
    '/media/Anime/Oshi no Ko/[SubsPlease] Oshi no Ko - 01 (1080p) [EEEEEEEE].mkv',
    'episode-anime-absolute',
    { type: 'episode', title: 'Oshi no Ko', episodes: [1], absolute: true },
  ],

  // —— 附加内容 ——
  [
    '/media/Movies/Inception (2010)/Inception (2010)-sample.mkv',
    'extra',
    { type: 'extra', title: 'Inception', year: 2010 },
  ],
  [
    '/media/Movies/Inception.2010.1080p.BluRay.x264-SPARKS/Sample/sparks-inception-1080p-sample.mkv',
    'extra',
    { type: 'extra', title: 'Inception', year: 2010 },
  ],
  [
    '/media/Movies/Dune (2021)/trailers/Dune Official Trailer 2.mkv',
    'extra',
    { type: 'extra', title: 'Dune', year: 2021 },
  ],
  [
    '/media/Movies/Dune (2021)/Dune (2021)-featurette.mkv',
    'extra',
    { type: 'extra', title: 'Dune', year: 2021 },
  ],
  [
    '/media/Movies/Dune (2021)/Dune (2021)-behindthescenes.mkv',
    'extra',
    { type: 'extra', title: 'Dune', year: 2021 },
  ],
  [
    '/media/Movies/Alien (1979)/Extras/Alien - Deleted Scenes.mkv',
    'extra',
    { type: 'extra', title: 'Alien', year: 1979 },
  ],
  [
    '/media/Movies/流浪地球 (2019)/花絮/幕后.mp4',
    'extra',
    { type: 'extra', title: '流浪地球', year: 2019 },
  ],
  [
    '/media/Movies/Heat (1995)/Heat.1995.Trailer.mkv',
    'extra',
    { type: 'extra', title: 'Heat', year: 1995 },
  ],
  [
    '/media/TV/Breaking Bad/Season 1/Breaking.Bad.S01E01.sample.mkv',
    'extra',
    { type: 'extra', title: 'Breaking Bad' },
  ],
  [
    '/media/TV/Breaking Bad (2008)/Featurettes/Inside Breaking Bad.mkv',
    'extra',
    { type: 'extra', title: 'Breaking Bad', year: 2008 },
  ],
  [
    '/media/Movies/Samsara.2011.1080p.BluRay.mkv',
    'movie-scene',
    { type: 'movie', title: 'Samsara', year: 2011 },
  ],
  [
    '/media/Movies/Trailer Park Boys The Movie (2006)/Trailer Park Boys The Movie (2006).mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'Trailer Park Boys The Movie', year: 2006 },
  ],
  [
    '/media/Movies/The Extras (2005)/The Extras (2005).mkv',
    'movie-bracket-year',
    { type: 'movie', title: 'The Extras', year: 2005 },
  ],
]

/** 手写难例列表。 */
export const hardCases: GoldenCase[] = rows.map(
  ([path, category, expected]) => ({
    path,
    category,
    expected,
    hand: true,
  })
)
