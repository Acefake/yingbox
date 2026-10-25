import { describe, expect, it } from 'vitest'
import type {
  LibraryItemNode,
  VisualFramesStatus,
  VisualStatus,
} from '../../../src/shared/library/ipc'
import type { PlayRequest } from '../../../src/renderer/src/features/library/detail/playback'
import {
  clock,
  framesBusy,
  framesText,
  hasPending,
  momentRequest,
  progressText,
  stageOf,
} from '../../../src/renderer/src/features/library/visual/visual-rules'

const frames: VisualFramesStatus = {
  enabled: true,
  paused: false,
  includeCloud: false,
  running: false,
  progress: null,
  indexed: 3,
  total: 5,
  frames: 120,
  error: null,
}

const base: VisualStatus = {
  runtime: true,
  model: 'ready',
  indexing: false,
  progress: null,
  indexed: 10,
  total: 12,
  error: null,
  frames,
}

describe('按画面搜面板阶段', () => {
  it('不可用 / 待建索引 / 进行中 / 可搜', () => {
    expect(stageOf({ ...base, runtime: false })).toBe('unavailable')
    expect(stageOf({ ...base, model: 'missing', indexed: 0 })).toBe('setup')
    expect(stageOf({ ...base, indexed: 0 })).toBe('setup')
    expect(stageOf({ ...base, indexing: true })).toBe('working')
    expect(stageOf(base)).toBe('ready')
    expect(stageOf(null)).toBe('setup')
  })

  it('进度文案与待补数量', () => {
    expect(
      progressText({
        ...base,
        indexing: true,
        model: 'downloading',
        progress: 0.42,
      })
    ).toBe('正在下载模型 42%')
    expect(progressText({ ...base, indexing: true, progress: 0.5 })).toBe(
      '正在建立索引 50% · 已完成 10 / 12 部'
    )
    expect(hasPending(base)).toBe(true)
    expect(hasPending({ ...base, indexed: 12 })).toBe(false)
  })
})

const HDR = { range: 'hdr10', dvProfile: null, dvCompat: null } as const

describe('视频画面', () => {
  it('时间点文案', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(75.9)).toBe('1:15')
    expect(clock(3723)).toBe('1:02:03')
    expect(clock(-3)).toBe('0:00')
  })

  it('状态文案：关 / 出错 / 暂停 / 进行中 / 等空闲 / 抽完', () => {
    expect(framesText({ ...frames, enabled: false })).toBe('')
    expect(framesText({ ...frames, error: '没有找到 ffmpeg' })).toBe(
      '没有找到 ffmpeg'
    )
    expect(framesText({ ...frames, paused: true })).toBe(
      '已暂停 · 3 / 5 个视频'
    )
    expect(framesText({ ...frames, running: true, progress: 0.25 })).toBe(
      '正在抽帧 25% · 3 / 5 个视频'
    )
    expect(framesText(frames)).toBe('空闲时抽帧 · 3 / 5 个视频')
    expect(framesText({ ...frames, indexed: 5 })).toBe(
      '5 / 5 个视频已抽帧，共 120 个画面'
    )
    expect(framesBusy({ ...base, frames: { ...frames, running: true } })).toBe(
      true
    )
    expect(framesBusy(null)).toBe(false)
  })

  it('播放请求定位到画面所在的文件和时间点，动态范围跟着那个文件', () => {
    const request: PlayRequest = {
      title: 'SSIS-1',
      playlist: [
        { filePath: '/v/cd1.mp4', name: 'cd1' },
        { filePath: '/v/cd2.mp4', name: 'cd2', video: HDR },
      ],
      fileIds: [7, 8],
      index: 0,
      item: { id: 1 } as LibraryItemNode,
    }
    expect(momentRequest(request, 8, 95)).toEqual({
      ...request,
      index: 1,
      startAt: 95,
      video: HDR,
    })
    expect(momentRequest(request, 7, 10)).toMatchObject({
      index: 0,
      startAt: 10,
    })
    expect(momentRequest(request, 7, 10)).not.toHaveProperty('video')
    expect(momentRequest(request, 9, 10)).toBeNull()
    expect(momentRequest(null, 7, 10)).toBeNull()
  })
})
