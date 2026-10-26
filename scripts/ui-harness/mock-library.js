// 注入到页面的假 window.api：5 万部电影 + 2000 部剧集，实现 query 的筛选 / 排序 / 搜索 / 分页。
;(() => {
  const N_MOVIES = 50000
  const N_SERIES = 2000
  const TMDB = 'https://image.tmdb.org/t/p'
  const words = [
    '北方',
    '回声',
    '流明',
    '漂流',
    '轨道',
    '港湾',
    '余烬',
    '天鹅绒',
    '地图',
    '子午线',
    '慰藉',
    '星火',
    '潮汐',
    '石英',
    '光环',
    '游牧',
    '极光',
    '山巅',
    '铆钉',
    '棱镜',
  ]
  const en = [
    'North',
    'Echo',
    'Lumen',
    'Drift',
    'Orbit',
    'Harbor',
    'Cinder',
    'Velvet',
    'Atlas',
    'Meridian',
    'Solace',
    'Ember',
    'Tide',
    'Quartz',
    'Halo',
    'Nomad',
    'Aurora',
    'Summit',
    'Rivet',
    'Prism',
  ]
  const states = i =>
    i % 47 === 0
      ? 'unmatched'
      : i % 23 === 0
        ? 'review'
        : i % 11 === 0
          ? 'locked'
          : 'auto'
  const items = []
  function make(id, type, i) {
    const w = i % 20
    const title =
      (type === 'movie' ? '' : '') +
      words[w] +
      (i >= 20 ? ` ${Math.floor(i / 20) + 1}` : '')
    const state = states(i)
    const matched = state === 'auto' || state === 'locked'
    return {
      id,
      libraryId: type === 'movie' ? 1 : 2,
      type,
      title,
      originalTitle: en[w] + (i >= 20 ? ` ${Math.floor(i / 20) + 1}` : ''),
      year: 1960 + ((i * 7) % 66),
      matchState: state,
      providerIds: matched
        ? { tmdb: String(100000 + id), imdb: 'tt' + String(1000000 + id) }
        : {},
      poster: matched || i % 3 === 0 ? `${TMDB}/w500/p${i % 240}.jpg` : null,
      backdrop: `${TMDB}/w1280/b${i % 40}.jpg`,
      rating: matched ? Math.round((5 + ((i * 37) % 45) / 10) * 10) / 10 : null,
      addedAt: 1700000000000 + i * 60000,
      updatedAt: 1700000000000 + i * 60000,
    }
  }
  for (let i = 0; i < N_MOVIES; i++) items.push(make(i + 1, 'movie', i))
  for (let i = 0; i < N_SERIES; i++)
    items.push(make(N_MOVIES + i + 1, 'series', i))
  const byId = new Map(items.map(it => [it.id, it]))

  const libraries = [
    {
      id: 1,
      name: 'Movies',
      root: '/Volumes/NAS/Movies',
      kind: 'movie',
      createdAt: 1700000000000,
      lastScanAt: Date.now() - 3600e3,
    },
    {
      id: 2,
      name: 'TV Shows',
      root: '/Volumes/NAS/TV',
      kind: 'tv',
      createdAt: 1700000000000,
      lastScanAt: Date.now() - 7200e3,
    },
  ]
  const stats = { queries: 0, queryMs: 0 }
  window.__libStats = stats
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title, 'zh') || a.id - b.id,
    year: (a, b) => (a.year ?? -1) - (b.year ?? -1) || a.id - b.id,
    rating: (a, b) => (a.rating ?? -1) - (b.rating ?? -1) || a.id - b.id,
    addedAt: (a, b) => a.addedAt - b.addedAt || a.id - b.id,
    updatedAt: (a, b) => a.updatedAt - b.updatedAt || a.id - b.id,
  }
  const sortedCache = new Map()
  function query(q = {}) {
    const t0 = performance.now()
    const types = q.types || ['movie', 'series']
    const sort = q.sort || 'title'
    const order = q.order || (sort === 'title' ? 'asc' : 'desc')
    const key = JSON.stringify([
      types,
      sort,
      order,
      q.matchStates,
      q.search,
      q.libraryId,
    ])
    let list = sortedCache.get(key)
    if (!list) {
      const s = q.search ? q.search.toLowerCase() : ''
      list = items.filter(
        it =>
          types.includes(it.type) &&
          (!q.matchStates || q.matchStates.includes(it.matchState)) &&
          (!q.libraryId || it.libraryId === q.libraryId) &&
          (!s ||
            it.title.toLowerCase().includes(s) ||
            it.originalTitle.toLowerCase().includes(s))
      )
      list.sort(cmp[sort])
      if (order === 'desc') list.reverse()
      sortedCache.set(key, list)
    }
    const offset = q.offset || 0,
      limit = q.limit || 200
    const result = {
      items: list.slice(offset, offset + limit),
      total: list.length,
      offset,
      limit,
    }
    stats.queries++
    stats.queryMs += performance.now() - t0
    return new Promise(r => setTimeout(() => r(structuredClone(result)), 4))
  }

  const cast = Array.from({ length: 14 }, (_, i) => ({
    id: String(i),
    name: [
      '周子瑜',
      '林予安',
      'Ava Chen',
      '陈默',
      'Leo Hart',
      '许知远',
      'Mia Park',
      '韩冬',
      '苏青',
      'Noah Kim',
      '白杨',
      '姜晚',
      '顾言',
      'Eli Moss',
    ][i],
    character: [
      '船长',
      '领航员',
      '工程师',
      '医生',
      '记者',
      '父亲',
      '女儿',
      '向导',
      '指挥官',
      '士兵',
      '学生',
      '画家',
      '老师',
      '店主',
    ][i],
    profilePath: `/a${i % 30}.jpg`,
    order: i,
  }))
  const crew = [
    { id: 'd1', name: '程远', job: 'Director' },
    { id: 'w1', name: '吴桐', job: 'Screenplay' },
    { id: 'w2', name: 'Sam Reed', job: 'Writer' },
  ]
  const overview =
    '在冰封的北方港口，一名退役领航员接到最后一次任务：护送一支科考队穿越永夜海峡。风暴、失灵的仪器与彼此隐瞒的过去，让这段航程变成一场关于信任与归途的考验。'
  function titleMeta(it) {
    return {
      level: 'title',
      ref: {
        provider: 'tmdb',
        kind: it.type === 'movie' ? 'movie' : 'tv',
        id: it.providerIds.tmdb || '0',
      },
      title: it.title,
      originalTitle: it.originalTitle,
      year: it.year,
      releaseDate: `${it.year}-09-14`,
      overview,
      tagline: '每一段航程，都有回不去的港口。',
      genres: ['剧情', '冒险', '科幻'],
      rating: it.rating,
      runtimeMinutes: 128,
      countries: ['CN', 'US'],
      companies: ['北辰影业', 'Lumen Pictures'],
      certification: 'PG-13',
      cast,
      crew,
      images: [],
      externalIds: {},
      status: it.type === 'series' ? 'Returning Series' : undefined,
    }
  }
  function nodeBase(it) {
    return {
      ...it,
      seasonNumber: null,
      episodeNumber: null,
      overview: it.matchState === 'unmatched' ? null : overview,
      logo: null,
      runtime: it.type === 'movie' ? 128 : null,
      genres: ['剧情', '冒险', '科幻'],
      airDate: `${it.year}-09-14`,
      metadata: it.matchState === 'unmatched' ? null : titleMeta(it),
      files: [],
      children: [],
    }
  }
  const epTitles = [
    '启航',
    '永夜',
    '冰层之下',
    '失灵',
    '信号',
    '归途',
    '旧港',
    '暗流',
    '灯塔',
    '回声',
  ]
  function getItem(id) {
    const it = byId.get(id)
    if (!it) return Promise.resolve(null)
    const n = nodeBase(it)
    const name = `${it.originalTitle.replace(/ /g, '.')}.${it.year}`
    if (it.type === 'movie') {
      n.files = [
        {
          id: id * 10,
          path: `/Volumes/NAS/Movies/${it.originalTitle} (${it.year})/${name}.2160p.UHD.BluRay.x265.mkv`,
          kind: 'video',
          size: 23.4e9,
          mtime: 0,
        },
        {
          id: id * 10 + 1,
          path: `/Volumes/NAS/Movies/${it.originalTitle} (${it.year})/${name}.nfo`,
          kind: 'nfo',
          size: 4e3,
          mtime: 0,
        },
      ]
    } else {
      n.children = [1, 2, 3].map(s => ({
        ...nodeBase(it),
        id: id * 100 + s,
        type: 'season',
        title: `第 ${s} 季`,
        seasonNumber: s,
        overview:
          s === 1
            ? '第一季：科考船“回声号”驶入永夜海峡，队员们各怀心事。'
            : null,
        metadata: null,
        children: Array.from({ length: s === 3 ? 6 : 10 }, (_, e) => ({
          ...nodeBase(it),
          id: id * 1000 + s * 50 + e,
          type: 'episode',
          title: epTitles[e],
          seasonNumber: s,
          episodeNumber: e + 1,
          overview: '风暴前夜，船上的无线电收到一段来自三十年前的求救信号。',
          poster: `${TMDB}/w300/s${(s * 10 + e) % 24}.jpg`,
          runtime: 52,
          airDate: `${it.year + s - 1}-0${(e % 9) + 1}-12`,
          metadata: null,
          files:
            s === 3 && e > 3
              ? []
              : [
                  {
                    id: id * 1000 + s * 50 + e,
                    path: `/Volumes/NAS/TV/${it.originalTitle}/Season ${s}/${it.originalTitle}.S0${s}E${String(e + 1).padStart(2, '0')}.1080p.WEB-DL.mkv`,
                    kind: 'video',
                    size: 2.1e9,
                    mtime: 0,
                  },
                ],
          children: [],
        })),
      }))
    }
    return new Promise(r => setTimeout(() => r(structuredClone(n)), 8))
  }
  function getMatchCandidates(id) {
    const it = byId.get(id)
    const mk = (k, conf, dy) => ({
      provider: 'tmdb',
      kind: it.type === 'movie' ? 'movie' : 'tv',
      id: String(200000 + id * 3 + k),
      title:
        k === 0 ? it.title : `${it.title}${['', '：重启', '（剧场版）'][k]}`,
      originalTitle: it.originalTitle,
      year: it.year + dy,
      confidence: conf,
      breakdown: { title: conf, year: 1 - Math.abs(dy) / 5 },
      poster: `${TMDB}/w185/p${(id + k * 7) % 240}.jpg`,
      overview: [
        overview,
        '一部关于海上救援的纪录式剧情片，讲述三名志愿者在风暴中坚持七十二小时的故事。',
        null,
      ][k],
    })
    return Promise.resolve({
      itemId: id,
      matchState: it.matchState,
      current: null,
      candidates:
        it.matchState === 'review'
          ? [mk(0, 0.74, 0), mk(1, 0.61, 2), mk(2, 0.43, -3)]
          : [],
    })
  }
  const listeners = new Set()
  const ok = v => () => Promise.resolve(v)
  const writerSettings = {
    nfo: { enabled: true, mode: 'merge' },
    artwork: {
      poster: true,
      fanart: true,
      logo: true,
      seasonArt: true,
      actors: false,
      legacyNames: false,
    },
    autoWriteAfterIdentify: false,
    organize: {
      enabled: false,
      movieTemplate: '{title} ({year})/{title} ({year}).{ext}',
      tvTemplate:
        '{series} ({year})/Season {season:02}/{series} - S{season:02}E{episode:02} - {episodeTitle}.{ext}',
    },
  }
  const library = {
    listLibraries: ok(libraries),
    addLibrary: ok(libraries[0]),
    removeLibrary: ok(undefined),
    scan: ok({ jobId: 1 }),
    query,
    getItem,
    identify: ok({ jobId: 2 }),
    getMatchCandidates,
    applyMatch: ok({ status: 'matched', item: null, candidates: [] }),
    lockMatch: id => Promise.resolve(byId.get(id)),
    unlockMatch: id => Promise.resolve(byId.get(id)),
    refreshMetadata: ok({ jobId: 3 }),
    setProviderToken: ok({
      tmdb: { configured: true },
      opensubtitles: { configured: false },
    }),
    getProviderStatus: ok({
      tmdb: { configured: true },
      opensubtitles: { configured: false },
    }),
    subscribe: l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    writer: {
      getSettings: () => Promise.resolve(structuredClone(writerSettings)),
      setSettings: s => Promise.resolve(s),
      write: ok({ jobId: 4 }),
      previewOrganize: ids =>
        Promise.resolve({
          planId: 'p',
          unchanged: 1,
          entries: ids
            .flatMap(id => {
              const it = byId.get(id)
              const n = `${it.originalTitle}.${it.year}`
              return [
                {
                  itemId: id,
                  kind: 'video',
                  from: `/Volumes/NAS/Movies/incoming/${n.replace(/ /g, '.')}.2160p.mkv`,
                  to: `/Volumes/NAS/Movies/${it.title} (${it.year})/${it.title} (${it.year}).mkv`,
                  crossDevice: false,
                },
                {
                  itemId: id,
                  kind: 'sidecar',
                  from: `/Volumes/NAS/Movies/incoming/${n.replace(/ /g, '.')}.2160p.zh.srt`,
                  to: `/Volumes/NAS/Movies/${it.title} (${it.year})/${it.title} (${it.year}).zh.srt`,
                  crossDevice: id % 2 === 0,
                },
              ]
            })
            .concat([
              {
                itemId: ids[0],
                kind: 'video',
                from: '/Volumes/NAS/Movies/incoming/dup.mkv',
                to: '/Volumes/NAS/Movies/北方 (1960)/北方 (1960).mkv',
                conflict: '目标已存在',
                crossDevice: false,
              },
            ]),
        }),
      applyOrganize: ok({ batchId: 7, jobId: 5 }),
      undoOrganize: ok({ jobId: 6 }),
      listOrganizeBatches: ok([
        {
          batchId: 6,
          state: 'done',
          createdAt: Date.now() - 86400e3,
          finishedAt: Date.now() - 86000e3,
          undoneAt: null,
          total: 42,
          moved: 42,
          failed: 0,
          itemIds: [1],
          error: null,
        },
      ]),
    },
  }
  window.__libEmit = e => listeners.forEach(l => l(e))
  const noop = () => Promise.resolve({ success: false })
  const deep = obj =>
    new Proxy(obj, {
      get: (t, k) =>
        k in t
          ? t[k]
          : typeof k === 'string' && k !== 'then'
            ? deep(Object.assign(() => Promise.resolve({ success: false }), {}))
            : undefined,
    })
  window.api = deep({
    library,
    win: {
      minimize: noop,
      maximize: noop,
      close: noop,
      isMaximized: () => Promise.resolve(false),
    },
    dialog: {
      openDirectory: () =>
        Promise.resolve({ success: true, canceled: true, filePaths: [] }),
    },
    shell: { openPath: noop },
  })
})()
