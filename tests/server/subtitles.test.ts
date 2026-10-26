/**
 * 独立服务的字幕：外挂字幕接口（网页播放器自动挂载）与自动中文字幕的接线（环境变量开关）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HttpFetch } from '../../src/main/library/identify/identify-module'
import {
  SUBTITLE_DAILY_LIMIT,
  autoSubtitleSettings,
  toolPaths,
} from '../../src/server/library-host'
import { SUBTITLE_MAX_BYTES } from '../../src/server/routes/subtitles'
import {
  LIBRARY_HTTP,
  type LibraryItemNode,
  type LibraryItemSummary,
  type SubtitleListing,
} from '../../src/shared/library/ipc'
import { type Harness, startServer } from './server-harness'

const offline = (async () =>
  new Response('not found', { status: 404 })) as unknown as HttpFetch

const SRT = '1\r\n00:00:01,000 --> 00:00:02,500\r\n你好，世界\r\n'
const ASS = [
  '[Script Info]',
  'ScriptType: v4.00+',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\b1}Hello{\\b0}',
].join('\n')

let h: Harness
let fileId: number

beforeAll(async () => {
  h = await startServer({
    fetch: offline,
    files: {
      'movies/Movie 2020/Movie.2020.mkv': 1024,
      // UTF-16LE 带 BOM：服务按 BOM 解码再转 WebVTT
      'movies/Movie 2020/Movie.2020.zh.srt': Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(SRT, 'utf16le'),
      ]),
      'movies/Movie 2020/Movie.2020.en.ass': ASS,
      'movies/Movie 2020/notes.txt': 'x',
    },
  })
  await h.ok('addLibrary', { root: `${h.media}/movies`, kind: 'movie' })
  await h.app.service.queue.idle()
  const [item] = (
    await h.ok<{ items: LibraryItemSummary[] }>('query', { sort: 'title' })
  ).items
  const node = await h.ok<LibraryItemNode>('getItem', { itemId: item.id })
  fileId = node.files.find(f => f.kind === 'video')!.id
})

afterAll(async () => {
  await h?.close()
})

describe('外挂字幕接口', () => {
  it('列出视频旁的字幕：同名语言变体，只给文件名与读取地址', async () => {
    const res = await h.call(`${LIBRARY_HTTP.subtitles}${fileId}`)
    expect(res.status).toBe(200)
    const { subtitles } = (await res.json()) as SubtitleListing
    expect(subtitles.map(s => [s.name, s.ext])).toEqual([
      ['Movie.2020.zh', '.srt'],
      ['Movie.2020.en', '.ass'],
    ])
    expect(subtitles[0].url).toBe(
      `${LIBRARY_HTTP.subtitles}${fileId}/Movie.2020.zh.srt`
    )
    expect(JSON.stringify(subtitles)).not.toContain(h.media)
  })

  it('srt（UTF-16）与 ass 都转成 WebVTT', async () => {
    const srt = await h.call(
      `${LIBRARY_HTTP.subtitles}${fileId}/Movie.2020.zh.srt`
    )
    expect(srt.headers.get('content-type')).toMatch(/^text\/vtt/)
    const vtt = await srt.text()
    expect(vtt).toMatch(/^WEBVTT/)
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500')
    expect(vtt).toContain('你好，世界')
    const ass = await (
      await h.call(`${LIBRARY_HTTP.subtitles}${fileId}/Movie.2020.en.ass`)
    ).text()
    expect(ass).toMatch(/^WEBVTT/)
    expect(ass).toContain('Hello')
    expect(ass).not.toContain('{\\b1}')
  })

  it('只读列表里的字幕：别的文件、目录穿越、未知视频、未登录都拒绝', async () => {
    const get = (path: string, auth = true): Promise<Response> =>
      h.call(`${LIBRARY_HTTP.subtitles}${path}`, { auth })
    expect((await get(`${fileId}/notes.txt`)).status).toBe(404)
    expect(
      (await get(`${fileId}/${encodeURIComponent('../../data/secrets.json')}`))
        .status
    ).toBe(404)
    expect((await get('999999')).status).toBe(404)
    expect((await get('abc')).status).toBe(404)
    expect((await get(`${fileId}`, false)).status).toBe(401)
  })

  it('过大的字幕文件不读', async () => {
    h.write(
      'movies/Movie 2020/Movie.2020.big.srt',
      Buffer.alloc(SUBTITLE_MAX_BYTES + 1, 0x31)
    )
    const res = await h.call(
      `${LIBRARY_HTTP.subtitles}${fileId}/Movie.2020.big.srt`
    )
    expect(res.status).toBe(413)
  })
})

describe('自动中文字幕与工具路径（环境变量）', () => {
  it('YINGBOX_AUTO_SUBTITLES 打开，每日上限夹在 1–100，默认 5', () => {
    expect(autoSubtitleSettings({})).toBeNull()
    expect(autoSubtitleSettings({ YINGBOX_AUTO_SUBTITLES: '0' })).toBeNull()
    expect(autoSubtitleSettings({ YINGBOX_AUTO_SUBTITLES: 'on' })).toEqual({
      enabled: true,
      dailyLimit: SUBTITLE_DAILY_LIMIT.fallback,
    })
    expect(
      autoSubtitleSettings({
        YINGBOX_AUTO_SUBTITLES: '1',
        YINGBOX_SUBTITLES_DAILY_LIMIT: '500',
      })?.dailyLimit
    ).toBe(100)
    expect(
      autoSubtitleSettings({
        YINGBOX_AUTO_SUBTITLES: 'true',
        YINGBOX_SUBTITLES_DAILY_LIMIT: '0',
      })?.dailyLimit
    ).toBe(1)
    // 空串、只有空白按没设：用默认值，不是 1
    for (const blank of ['', '  '])
      expect(
        autoSubtitleSettings({
          YINGBOX_AUTO_SUBTITLES: 'on',
          YINGBOX_SUBTITLES_DAILY_LIMIT: blank,
        })?.dailyLimit
      ).toBe(SUBTITLE_DAILY_LIMIT.fallback)
  })

  it('ffprobe / ffmpeg：环境变量优先，没设时用 PATH', () => {
    expect(toolPaths({})).toEqual({ ffprobe: 'ffprobe', ffmpeg: 'ffmpeg' })
    expect(
      toolPaths({ YINGBOX_FFPROBE: '/opt/ff/ffprobe', YINGBOX_FFMPEG: ' ' })
    ).toEqual({ ffprobe: '/opt/ff/ffprobe', ffmpeg: 'ffmpeg' })
  })

  it('默认不启动自动字幕；打开后片库服务里有自动字幕模块', async () => {
    expect(h.app.service.intake.subtitles).toBeNull()
    const on = await startServer({
      fetch: offline,
      env: { YINGBOX_AUTO_SUBTITLES: '1' },
    })
    try {
      expect(on.app.service.intake.subtitles).not.toBeNull()
    } finally {
      await on.close()
    }
  })
})
