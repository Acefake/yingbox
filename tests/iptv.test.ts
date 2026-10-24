import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EPG_TTL_MS,
  createEpgStore,
  decodeEpgBytes,
} from '../src/main/iptv/epg-store'
import {
  currentProgramme,
  formatClock,
  nextProgramme,
  programmeProgress,
  scheduleRows,
  todayRange,
} from '../src/renderer/src/features/live/utils/epg-rules'
import {
  ALL_GROUP,
  FAVORITES_GROUP,
  buildGroups,
  combineChannels,
  epgUrlsFor,
  filterChannels,
  isLikelyHls,
  nextLine,
  sanitizeSource,
  toggleFavorite,
} from '../src/renderer/src/features/live/utils/live-rules'
import {
  DEFAULT_GROUP,
  detectFormat,
  parsePlaylist,
  splitExtinf,
} from '../src/renderer/src/features/live/utils/playlist-parse'
import {
  buildEpgIndex,
  decodeXmlText,
  matchEpgChannel,
  normalizeChannelName,
  parseXmltv,
  parseXmltvTime,
} from '../src/shared/iptv/xmltv'

const M3U = `#EXTM3U x-tvg-url="https://epg.example.com/e.xml.gz,https://epg.example.com/b.xml"
#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV1" tvg-logo="https://logo.example.com/cctv1.png" group-title="央视",CCTV-1 综合
https://a.example.com/cctv1.m3u8
#EXTINF:-1 tvg-id="cctv1" group-title="央视",CCTV-1 综合
https://b.example.com/cctv1/index.m3u8
#EXTINF:-1 tvg-name="某台, 高清" group-title="地方",某台, 高清
#EXTVLCOPT:http-user-agent=Foo
https://c.example.com/live?id=3
#EXTINF:-1,无分组台
#EXTGRP:其他
http://d.example.com/x.m3u8
#EXTINF:-1 group-title="坏的",RTSP 台
rtsp://e.example.com/stream
`

const TXT = `央视频道,#genre#
CCTV1,https://a.example.com/1.m3u8$线路一#https://b.example.com/1.m3u8
CCTV1,https://c.example.com/1.m3u8
CCTV2,https://a.example.com/2.m3u8
卫视频道,#genre#
湖南卫视,https://a.example.com/hn.m3u8
// 注释行
没有地址
`

describe('m3u 解析', () => {
  it('读出频道属性、头部节目单地址，同名频道合并为多条线路', () => {
    const result = parsePlaylist(M3U)
    expect(result.format).toBe('m3u')
    expect(result.epgUrls).toEqual([
      'https://epg.example.com/e.xml.gz',
      'https://epg.example.com/b.xml',
    ])
    const cctv1 = result.channels[0]
    expect(cctv1).toMatchObject({
      name: 'CCTV-1 综合',
      group: '央视',
      tvgId: 'cctv1',
      tvgName: 'CCTV1',
      logo: 'https://logo.example.com/cctv1.png',
    })
    expect(cctv1.urls).toEqual([
      'https://a.example.com/cctv1.m3u8',
      'https://b.example.com/cctv1/index.m3u8',
    ])
  })

  it('引号里的逗号不截断频道名；#EXTGRP 补分组；非 http 地址丢弃', () => {
    const result = parsePlaylist(M3U)
    expect(result.channels.map(c => c.name)).toEqual([
      'CCTV-1 综合',
      '某台, 高清',
      '无分组台',
    ])
    expect(result.channels[1].urls).toEqual(['https://c.example.com/live?id=3'])
    expect(result.channels[2].group).toBe('其他')
  })

  it('splitExtinf 拆出属性与标题；去掉 BOM 也能识别格式', () => {
    expect(splitExtinf('#EXTINF:-1 group-title="a,b",名字')).toEqual({
      attrs: { 'group-title': 'a,b' },
      title: '名字',
    })
    expect(detectFormat('\n#EXTINF:-1,x\nhttp://a')).toBe('m3u')
    expect(
      parsePlaylist('\uFEFF#EXTM3U\n#EXTINF:-1,A\nhttp://a/1').format
    ).toBe('m3u')
  })
})

describe('TVBox txt 解析', () => {
  it('#genre# 开分组，# 分隔多地址、$ 后是备注，同名合并', () => {
    const result = parsePlaylist(TXT)
    expect(result.format).toBe('txt')
    expect(result.epgUrls).toEqual([])
    expect(result.channels.map(c => [c.name, c.group])).toEqual([
      ['CCTV1', '央视频道'],
      ['CCTV2', '央视频道'],
      ['湖南卫视', '卫视频道'],
    ])
    expect(result.channels[0].urls).toEqual([
      'https://a.example.com/1.m3u8',
      'https://b.example.com/1.m3u8',
      'https://c.example.com/1.m3u8',
    ])
  })

  it('分组行之前的频道归到默认分组', () => {
    const result = parsePlaylist('台A,http://a/1.m3u8')
    expect(result.channels[0].group).toBe(DEFAULT_GROUP)
  })
})

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="CCTV1"><display-name lang="zh">CCTV-1 综合</display-name><display-name>CCTV1</display-name></channel>
  <channel id="hunan"><display-name>湖南卫视</display-name></channel>
  <programme start="20261024080000 +0800" stop="20261024090000 +0800" channel="CCTV1"><title lang="zh">朝闻天下</title></programme>
  <programme start="20261024090000 +0800" stop="20261024100000 +0800" channel="CCTV1"><title><![CDATA[新闻 & 天气]]></title></programme>
  <programme start="20261024070000 +0800" stop="20261024080000 +0800" channel="CCTV1"><title>早间&amp;晨读</title></programme>
  <programme start="20261024100000 +0800" channel="hunan"><title>快乐大本营</title></programme>
  <programme start="20261024120000 +0800" channel="hunan"><title>午间新闻</title></programme>
  <programme start="20200101000000 +0800" stop="20200101010000 +0800" channel="hunan"><title>很久以前</title></programme>
</tv>`

const at = (s: string): number => Date.parse(s)

describe('XMLTV 解析', () => {
  it('时间带时区换算成 UTC 毫秒；无时区按 UTC', () => {
    expect(parseXmltvTime('20261024080000 +0800')).toBe(
      at('2026-10-24T00:00:00Z')
    )
    expect(parseXmltvTime('202610240800 -0130')).toBe(
      at('2026-10-24T09:30:00Z')
    )
    expect(parseXmltvTime('20261024080000')).toBe(at('2026-10-24T08:00:00Z'))
    expect(parseXmltvTime('bad')).toBeNull()
  })

  it('实体与 CDATA 解码', () => {
    expect(decodeXmlText(' a &amp; b &#x4E2D;&#25991; ')).toBe('a & b 中文')
    expect(decodeXmlText('<![CDATA[x < y]]>')).toBe('x < y')
  })

  it('节目按开始时间排序，缺结束时间用下一档补；范围外的丢弃', () => {
    const data = parseXmltv(XML, {
      from: at('2026-10-23T00:00:00Z'),
      to: at('2026-10-25T00:00:00Z'),
    })
    expect(data.channels).toEqual([
      { id: 'CCTV1', names: ['CCTV-1 综合', 'CCTV1'] },
      { id: 'hunan', names: ['湖南卫视'] },
    ])
    expect(data.programmes.CCTV1.map(p => p.title)).toEqual([
      '早间&晨读',
      '朝闻天下',
      '新闻 & 天气',
    ])
    const hunan = data.programmes.hunan
    expect(hunan.map(p => p.title)).toEqual(['快乐大本营', '午间新闻'])
    expect(hunan[0].stop).toBe(hunan[1].start)
  })

  it('频道匹配：tvg-id 精确优先，其次归一化名称', () => {
    const index = buildEpgIndex(parseXmltv(XML))
    expect(matchEpgChannel(index, { tvgId: 'hunan', names: [] })).toBe('hunan')
    expect(matchEpgChannel(index, { names: ['CCTV-1 高清'] })).toBe('CCTV1')
    expect(matchEpgChannel(index, { tvgId: 'x', names: ['湖南卫视HD'] })).toBe(
      'hunan'
    )
    expect(matchEpgChannel(index, { names: ['不存在'] })).toBeUndefined()
    expect(normalizeChannelName('ＣＣＴＶ-13 新闻')).toBe('cctv13')
    expect(normalizeChannelName('CCTV5+ 体育赛事')).toBe('cctv5+')
  })
})

describe('当前节目计算', () => {
  const list = parseXmltv(XML).programmes.CCTV1

  it('二分查找正在播出的节目与下一档', () => {
    const now = at('2026-10-24T00:30:00Z')
    expect(currentProgramme(list, now)?.title).toBe('朝闻天下')
    expect(nextProgramme(list, now)?.title).toBe('新闻 & 天气')
    expect(currentProgramme(list, at('2026-10-24T05:00:00Z'))).toBeNull()
    expect(currentProgramme(undefined, 0)).toBeNull()
  })

  it('进度限制在 0–1', () => {
    const p = { start: 1000, stop: 2000, title: '' }
    expect(programmeProgress(p, 1500)).toBe(0.5)
    expect(programmeProgress(p, 500)).toBe(0)
    expect(programmeProgress(p, 9000)).toBe(1)
    expect(programmeProgress({ start: 1, stop: 1, title: '' }, 1)).toBe(0)
  })

  it('今日节目单标出已播 / 正在播 / 未播', () => {
    const now = at('2026-10-24T00:30:00Z')
    const { from, to } = todayRange(now)
    expect(to - from).toBeGreaterThanOrEqual(23 * 3600_000)
    const rows = scheduleRows(list, now)
    // 「今天」按本机时区算，凌晨的节目是否在今天内随时区变化，只校验状态
    expect(rows.find(r => r.state === 'live')?.title).toBe('朝闻天下')
    expect(rows.filter(r => r.state === 'upcoming').map(r => r.title)).toEqual([
      '新闻 & 天气',
    ])
    expect(rows.every(r => r.state !== 'past' || r.stop <= now)).toBe(true)
    expect(formatClock(new Date(2026, 0, 1, 7, 5).getTime())).toBe('07:05')
  })
})

describe('直播页规则', () => {
  const a = parsePlaylist(TXT).channels
  const b = parsePlaylist(
    '#EXTM3U\n#EXTINF:-1 tvg-logo="https://l/1.png" group-title="X",CCTV1\nhttps://z.example.com/1.m3u8'
  ).channels

  it('多源合并：同名频道线路追加、补齐台标', () => {
    const merged = combineChannels([a, b])
    const cctv1 = merged.find(c => c.id === 'cctv1')!
    expect(cctv1.group).toBe('央视频道')
    expect(cctv1.logo).toBe('https://l/1.png')
    expect(cctv1.urls.at(-1)).toBe('https://z.example.com/1.m3u8')
    expect(merged).toHaveLength(3)
  })

  it('分组、收藏与搜索', () => {
    const favs = new Set(['cctv2'])
    const groups = buildGroups(a, favs)
    expect(groups.map(g => [g.key, g.count])).toEqual([
      [FAVORITES_GROUP, 1],
      [ALL_GROUP, 3],
      ['央视频道', 2],
      ['卫视频道', 1],
    ])
    expect(filterChannels(a, FAVORITES_GROUP, '', favs).map(c => c.id)).toEqual(
      ['cctv2']
    )
    expect(filterChannels(a, '卫视频道', '', favs).map(c => c.name)).toEqual([
      '湖南卫视',
    ])
    expect(filterChannels(a, ALL_GROUP, 'cc tv', favs)).toHaveLength(2)
    expect(toggleFavorite(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleFavorite(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('换线、HLS 判定、节目单地址选择、源记录校验', () => {
    expect(nextLine(0, 3)).toBe(1)
    expect(nextLine(2, 3)).toBeNull()
    expect(isLikelyHls('https://a/live.m3u8?t=1')).toBe(true)
    expect(isLikelyHls('https://a/api/live?id=3')).toBe(true)
    expect(isLikelyHls('https://a/movie.mp4')).toBe(false)
    const source = sanitizeSource({
      id: 's1',
      kind: 'url',
      location: ' https://a/list.m3u ',
      epgUrl: '',
    })!
    expect(source).toMatchObject({ enabled: true, name: 'https://a/list.m3u' })
    expect(epgUrlsFor(source, ['https://e/1.xml'])).toEqual(['https://e/1.xml'])
    expect(
      epgUrlsFor({ ...source, epgUrl: 'https://mine/e.xml.gz' }, [
        'https://e/1',
      ])
    ).toEqual(['https://mine/e.xml.gz'])
    expect(sanitizeSource({ id: 'x', kind: 'ftp', location: 'a' })).toBeNull()
  })
})

describe('节目单缓存（主进程）', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })

  it('gzip 按魔数解压', () => {
    expect(decodeEpgBytes(gzipSync(Buffer.from('<tv/>')))).toBe('<tv/>')
    expect(decodeEpgBytes(Buffer.from('<tv/>'))).toBe('<tv/>')
  })

  it('12 小时内复用缓存（含磁盘），force 或过期后重新下载', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'iptv-epg-'))
    dirs.push(cacheDir)
    let clock = at('2026-10-24T00:30:00Z')
    const download = vi.fn(async () => gzipSync(Buffer.from(XML)))
    const store = createEpgStore({ download, cacheDir, now: () => clock })
    const url = 'https://epg.example.com/e.xml.gz'

    const first = await store.load(url, false)
    expect(first).toMatchObject({ ok: true, channels: 2 })
    await store.load(url, false)
    expect(download).toHaveBeenCalledTimes(1)

    const data = await store.programmes(
      url,
      [
        { key: 'c1', tvgId: 'CCTV1', names: [] },
        { key: 'hn', names: ['湖南卫视 HD'] },
        { key: 'none', names: ['无'] },
      ],
      at('2026-10-24T00:00:00Z'),
      at('2026-10-24T03:00:00Z')
    )
    expect(Object.keys(data).sort()).toEqual(['c1', 'hn'])
    expect(data.c1.map(p => p.title)).toEqual(['朝闻天下', '新闻 & 天气'])

    // 新实例读磁盘缓存（等写盘完成）
    await new Promise(resolve => setTimeout(resolve, 50))
    const again = createEpgStore({ download, cacheDir, now: () => clock })
    await again.load(url, false)
    expect(download).toHaveBeenCalledTimes(1)

    await again.load(url, true)
    expect(download).toHaveBeenCalledTimes(2)

    clock += EPG_TTL_MS + 1
    await again.load(url, false)
    expect(download).toHaveBeenCalledTimes(3)
  })

  it('不是 XMLTV 时报错', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'iptv-epg-'))
    dirs.push(cacheDir)
    const store = createEpgStore({
      download: async () => Buffer.from('<html>no</html>'),
      cacheDir,
    })
    const result = await store.load('https://x/e.xml', false)
    expect(result.ok).toBe(false)
  })
})
