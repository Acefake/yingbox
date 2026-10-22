import { describe, expect, it } from 'vitest'
import type { VisualStatus } from '../../../src/shared/library/ipc'
import {
  hasPending,
  progressText,
  stageOf,
} from '../../../src/renderer/src/features/library/visual/visual-rules'

const base: VisualStatus = {
  runtime: true,
  model: 'ready',
  indexing: false,
  progress: null,
  indexed: 10,
  total: 12,
  error: null,
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
