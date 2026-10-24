import { describe, expect, it } from 'vitest'
import { danmakuTargetFor } from '../src/renderer/src/features/player/danmaku/danmaku-target'

/** 播放会话当前条目 → 弹幕匹配目标 */
describe('danmakuTargetFor', () => {
  const label = (e: { name?: string }): string => e.name || '未命名'

  it('多集带集名与序号，默认标题时用条目名，本地路径取实际在播条目', () => {
    const playlist = [
      { name: '第1集' },
      { name: ' 第2集 ', filePath: '/a/2.mkv' },
    ]
    expect(
      danmakuTargetFor({
        playlist,
        position: 1,
        title: '某剧',
        current: playlist[1],
        label,
      })
    ).toEqual({
      title: '某剧',
      episode: '第2集',
      index: 2,
      filePath: '/a/2.mkv',
    })
    expect(
      danmakuTargetFor({
        playlist,
        position: 0,
        title: '正在播放',
        current: null,
        label,
      })
    ).toMatchObject({ title: '第1集', index: 1, filePath: undefined })
  })

  it('单条目不带集名 / 序号；越界为 null', () => {
    const playlist = [{ name: '电影' }]
    expect(
      danmakuTargetFor({
        playlist,
        position: 0,
        title: '电影',
        current: null,
        label,
      })
    ).toEqual({
      title: '电影',
      episode: undefined,
      index: undefined,
      filePath: undefined,
    })
    expect(
      danmakuTargetFor({
        playlist,
        position: 3,
        title: 'x',
        current: null,
        label,
      })
    ).toBeNull()
  })
})
