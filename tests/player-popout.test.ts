import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizePlayerPayload,
  playlistEntryLabel,
} from '../src/renderer/src/features/player/utils/popout-queue'
import { useProgressSaver } from '../src/renderer/src/features/player/composables/use-progress-saver'

describe('独立播放窗口的播放队列', () => {
  it('没有列表也没有地址时忽略', () => {
    expect(normalizePlayerPayload({ title: 'x' })).toBeNull()
    expect(normalizePlayerPayload({ url: '  ', playlist: [] })).toBeNull()
  })

  it('单条目变成长度为 1 的队列，地址作为已解析的起始地址复用', () => {
    const q = normalizePlayerPayload({
      url: ' https://a/1.m3u8 ',
      title: ' 片名 ',
      startAt: -3,
    })
    expect(q).toMatchObject({
      playlist: [{ url: 'https://a/1.m3u8' }],
      position: 0,
      title: '片名',
      startAt: 0,
      seededUrl: 'https://a/1.m3u8',
    })
  })

  it('列表下标越界或非整数时从第一集开始；空条目被过滤', () => {
    const list = [{ name: 'a' }, null as never, { name: 'b' }]
    expect(normalizePlayerPayload({ playlist: list, index: 1 })?.position).toBe(
      1
    )
    expect(normalizePlayerPayload({ playlist: list, index: 2 })?.position).toBe(
      0
    )
    expect(
      normalizePlayerPayload({ playlist: list, index: 0.5 })?.playlist
    ).toHaveLength(2)
  })

  it('缺省标题为「正在播放」，startAt 非有限数时不给', () => {
    const q = normalizePlayerPayload({
      filePath: '/m/a.mkv',
      startAt: Number.NaN,
    })
    expect(q?.title).toBe('正在播放')
    expect(q?.startAt).toBeUndefined()
    expect(q?.seededUrl).toBeUndefined()
  })

  it('条目显示名：name → 文件名 → 默认标题', () => {
    expect(playlistEntryLabel({ name: ' 第 1 集 ' }, '默认')).toBe('第 1 集')
    expect(playlistEntryLabel({ filePath: 'C:\\v\\b.mp4' }, '默认')).toBe(
      'b.mp4'
    )
    expect(playlistEntryLabel(null, '默认')).toBe('默认')
  })
})

describe('播放进度节流保存', () => {
  afterEach(() => vi.unstubAllGlobals())

  const setup = () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => (store[k] = v),
    })
    let t = 10_000
    const saver = useProgressSaver(
      () => 'k',
      () => t
    )
    const tick = (currentTime: number, advance = 0): void => {
      t += advance
      saver.onTimeUpdate({ target: { currentTime, duration: 600 } } as never)
    }
    const saved = (): number =>
      JSON.parse(store.media_play_progress || '{}').k?.progress ?? -1
    return { saver, tick, saved }
  }

  it('2 秒内只写一次，flush 写入最后位置', () => {
    const { saver, tick, saved } = setup()
    tick(30)
    expect(saved()).toBe(30)
    tick(31, 500)
    expect(saved()).toBe(30)
    tick(33, 2000)
    expect(saved()).toBe(33)
    tick(34, 100)
    saver.flush()
    expect(saved()).toBe(34)
  })

  it('看完把续播点清零，切集后 flush 不写旧位置', () => {
    const { saver, tick, saved } = setup()
    tick(500)
    saver.markFinished({ duration: 600 } as HTMLVideoElement)
    expect(saved()).toBe(0)
    tick(40, 3000)
    tick(45, 100)
    saver.reset()
    saver.flush()
    expect(saved()).toBe(40)
  })
})
