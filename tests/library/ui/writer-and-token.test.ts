import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

// 设置层在 import 时会读快照（需要 window / localStorage），这里只测媒体库一侧的编排
vi.mock('@/features/settings', () => ({
  setTmdbToken: vi.fn(),
}))

import { saveLibraryTmdbToken } from '../../../src/renderer/src/features/library/settings/provider-token'
import type {
  LibraryWriterBridge,
  OrganizePlan,
  ProviderStatus,
} from '../../../src/shared/library/ipc'
import {
  runnableCount,
  useWriter,
  writerActivity,
} from '../../../src/renderer/src/features/library/writer/use-writer'

const status = (configured: boolean): ProviderStatus => ({
  tmdb: { configured },
  opensubtitles: { configured: false },
})

describe('saveLibraryTmdbToken', () => {
  it('先交主进程保存（去掉首尾空白），再读引擎状态；不自己写引擎', async () => {
    const calls: string[] = []
    const save = vi.fn(
      async (value: string) => void calls.push(`save:${value}`)
    )
    let configured = false
    const bridge = {
      getProviderStatus: vi.fn(async () => {
        calls.push('status')
        return status(configured)
      }),
    }
    configured = true
    expect(
      (await saveLibraryTmdbToken(bridge, ' eyJnew ', save)).tmdb.configured
    ).toBe(true)
    configured = false
    expect((await saveLibraryTmdbToken(bridge, '', save)).tmdb.configured).toBe(
      false
    )
    expect(calls).toEqual(['save:eyJnew', 'status', 'save:', 'status'])
  })
})

const PLAN: OrganizePlan = {
  planId: 'p1',
  unchanged: 4,
  entries: [
    {
      itemId: 1,
      kind: 'video',
      from: '/a/x.mkv',
      to: '/a/X (2000)/X (2000).mkv',
      crossDevice: false,
    },
    {
      itemId: 2,
      kind: 'sidecar',
      from: '/a/y.mkv',
      to: '/b/Y (2001)/Y (2001).mkv',
      crossDevice: true,
    },
    {
      itemId: 3,
      kind: 'video',
      from: '/a/z.mkv',
      to: '/a/X (2000)/X (2000).mkv',
      conflict: '目标已存在',
      crossDevice: false,
    },
  ],
}

function installWriter(writer: Partial<LibraryWriterBridge> | undefined): void {
  vi.stubGlobal('window', {
    api: {
      library: {
        subscribe: () => () => {},
        ...(writer ? { writer } : {}),
      },
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useWriter', () => {
  it('计划里有冲突的项不算在执行数里', () => {
    expect(runnableCount(PLAN)).toBe(2)
  })

  it('没有 writer（网页版 / 旧 preload）：不可用，写出返回提示', async () => {
    installWriter(undefined)
    const scope = effectScope()
    const writer = scope.run(() => useWriter())!
    expect(writer.available).toBe(false)
    expect(await writer.write([1])).toContain('桌面版')
    scope.stop()
  })

  it('writer-progress → 进度文字', () => {
    const base = {
      type: 'writer-progress' as const,
      jobId: 1,
      total: 10,
      done: 4,
      written: 3,
      skipped: 1,
      failed: 0,
      finished: false,
    }
    expect(writerActivity({ ...base, mode: 'write' })).toEqual({
      label: '正在写出 NFO 与图片 4 / 10',
      progress: 0.4,
    })
    expect(
      writerActivity({ ...base, mode: 'undo', batchId: 3 }).label
    ).toContain('撤销')
  })

  it('整理：预览 → 执行 → 撤销', async () => {
    const bridge = {
      previewOrganize: vi.fn(async () => PLAN),
      applyOrganize: vi.fn(async () => ({ batchId: 42, jobId: 9 })),
      undoOrganize: vi.fn(async () => ({ jobId: 10 })),
    }
    installWriter(bridge)
    const scope = effectScope()
    const writer = scope.run(() => useWriter())!
    expect(writer.available).toBe(true)

    await writer.previewOrganize([1, 2, 3])
    expect(bridge.previewOrganize).toHaveBeenCalledWith([1, 2, 3])
    expect(writer.organize.value).toEqual({ stage: 'preview', plan: PLAN })

    await writer.applyOrganize()
    expect(bridge.applyOrganize).toHaveBeenCalledWith('p1')
    expect(writer.organize.value).toEqual({
      stage: 'applied',
      batchId: 42,
      moved: 2,
    })

    await writer.undoOrganize(42)
    expect(bridge.undoOrganize).toHaveBeenCalledWith(42)
    expect(writer.organize.value).toEqual({ stage: 'undone' })
    scope.stop()
  })

  it('预览失败进入 error 阶段，错误码前缀去掉', async () => {
    installWriter({
      previewOrganize: vi.fn(async () => {
        throw new Error('[library:conflict] 模板不合法')
      }),
    })
    const scope = effectScope()
    const writer = scope.run(() => useWriter())!
    await writer.previewOrganize([1])
    expect(writer.organize.value).toEqual({
      stage: 'error',
      message: '模板不合法',
    })
    // 不在预览阶段时执行无效
    await writer.applyOrganize()
    expect(writer.organize.value.stage).toBe('error')
    scope.stop()
  })
})
