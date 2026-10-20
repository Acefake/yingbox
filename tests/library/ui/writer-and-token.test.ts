import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { migrateLegacyTmdbToken } from '../../../src/renderer/src/features/library/settings/provider-token'
import type {
  LibraryWriterBridge,
  OrganizePlan,
} from '../../../src/shared/library/ipc'
import {
  runnableCount,
  useWriter,
  writerActivity,
} from '../../../src/renderer/src/features/library/writer/use-writer'

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('migrateLegacyTmdbToken', () => {
  it('引擎未配置、本地有旧令牌：下发一次并记下已迁移', async () => {
    const bridge = {
      getProviderStatus: vi.fn(async () => ({
        tmdb: { configured: false },
        opensubtitles: { configured: false },
      })),
      setProviderToken: vi.fn(async () => ({
        tmdb: { configured: true },
        opensubtitles: { configured: false },
      })),
    }
    const store = storage()
    expect(await migrateLegacyTmdbToken(bridge, store, () => ' eyJold ')).toBe(
      true
    )
    expect(bridge.setProviderToken).toHaveBeenCalledWith('tmdb', 'eyJold')
    expect(store.getItem('library.tmdbTokenMigrated')).toBe('1')

    // 第二次启动不再覆盖引擎里的令牌
    expect(await migrateLegacyTmdbToken(bridge, store, () => 'eyJnew')).toBe(
      false
    )
    expect(bridge.setProviderToken).toHaveBeenCalledTimes(1)
  })

  it('引擎已配置：不覆盖，只记已迁移', async () => {
    const bridge = {
      getProviderStatus: vi.fn(async () => ({
        tmdb: { configured: true },
        opensubtitles: { configured: false },
      })),
      setProviderToken: vi.fn(),
    }
    const store = storage()
    expect(await migrateLegacyTmdbToken(bridge, store, () => 'eyJold')).toBe(
      false
    )
    expect(bridge.setProviderToken).not.toHaveBeenCalled()
    expect(store.getItem('library.tmdbTokenMigrated')).toBe('1')
  })

  it('没有引擎（网页版）：什么也不做，等桌面版再迁', async () => {
    const store = storage()
    expect(await migrateLegacyTmdbToken(null, store, () => 'eyJold')).toBe(
      false
    )
    expect(store.getItem('library.tmdbTokenMigrated')).toBeNull()
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

function installWriter(writer: Partial<LibraryWriterBridge> | undefined) {
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
