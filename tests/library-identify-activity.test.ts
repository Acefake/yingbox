import { describe, expect, it, vi } from 'vitest'

import type { LibraryEvent } from '../src/shared/library/ipc'

// 引擎事件流与桥接：测试里手动推事件
const listeners: Array<(event: LibraryEvent) => void> = []
vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({ listLibraries: async () => [] }),
  errorText: (e: unknown) => String(e),
}))
vi.mock('../src/renderer/src/features/library/state/library-events', () => ({
  subscribeLibraryEvents: (listener: (event: LibraryEvent) => void) => {
    listeners.push(listener)
    return () => {}
  },
}))
vi.mock('../src/renderer/src/features/library/settings/folder-picker', () => ({
  pickLibraryFolder: vi.fn(),
}))

const { useIdentifyActivity, useLibraries } =
  await import('../src/renderer/src/features/library/state/use-libraries')

const emit = (event: LibraryEvent): void =>
  listeners.forEach(listener => listener(event))

const progress = (done: number, finished = false): LibraryEvent => ({
  type: 'identify-progress',
  jobId: 1,
  mode: 'identify',
  libraryId: null,
  total: 1893,
  done,
  matched: 0,
  review: 0,
  unmatched: 0,
  failed: 0,
  finished,
})

/**
 * 识别进度跨电影 / 剧集 / 番号分区：只给侧栏「后台任务」（useIdentifyActivity），
 * 分区页面顶部的进度条只显示扫描。
 */
describe('识别进度的归属', () => {
  it('识别中：后台任务拿到进度，各分区页面的进度条不显示', () => {
    const identifying = useIdentifyActivity()
    const movie = useLibraries('movie')
    const tv = useLibraries('tv')
    emit(progress(755))
    expect(identifying.value).toEqual({
      label: '正在识别 755 / 1893',
      progress: 755 / 1893,
    })
    expect(movie.activity.value).toBeNull()
    expect(tv.activity.value).toBeNull()
  })

  it('识别结束后清空；扫描仍显示在分区页面上', () => {
    const identifying = useIdentifyActivity()
    const movie = useLibraries('movie')
    emit(progress(1893, true))
    expect(identifying.value).toBeNull()
    emit({ type: 'job', jobId: 9, jobType: 'scan', state: 'running' })
    expect(movie.activity.value).toEqual({ label: '正在扫描文件夹…' })
  })
})
