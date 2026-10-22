import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultValues, parseSetting } from '../src/shared/settings/schema'
import type { ItemPreview } from '../src/shared/library/ipc'

/**
 * 悬停预览的接入：设置项、豆瓣卡与海报墙的预览来源、UiPosterCard 的预览层、外观设置分区。
 */

describe('设置项', () => {
  it('默认开启、等待 600 ms；等待时间限制在 200–2000 ms', () => {
    const values = defaultValues()
    expect(values['ui.hoverPreview']).toBe(true)
    expect(values['ui.hoverPreviewDelay']).toBe(600)
    expect(parseSetting('ui.hoverPreviewDelay', 1000)).toEqual({
      key: 'ui.hoverPreviewDelay',
      value: 1000,
    })
    expect(parseSetting('ui.hoverPreviewDelay', 50)).toBeUndefined()
    expect(parseSetting('ui.hoverPreviewDelay', 5000)).toBeUndefined()
    expect(parseSetting('ui.hoverPreview', 'yes')).toBeUndefined()
  })
})

describe('豆瓣卡的预览来源', () => {
  it('从条目地址取 ID，按分类取预告；无预告返回 null；不是豆瓣条目不预览', async () => {
    const { doubanPreviewSource, doubanSubjectId } =
      await import('../src/renderer/src/features/online/utils/douban-preview')
    expect(doubanSubjectId('https://movie.douban.com/subject/35267208/')).toBe(
      '35267208'
    )
    expect(doubanSubjectId('https://example.com/subject/1/')).toBeNull()

    const fetchTrailer = vi.fn(async (id: string) =>
      id === '1' ? 'https://vt1.doubanio.com/a.mp4' : null
    )
    const tv = doubanPreviewSource(
      { url: 'https://movie.douban.com/subject/1/', kind: 'tv' },
      fetchTrailer
    )!
    expect(tv.key).toBe('douban:1')
    expect(await tv.resolve(new AbortController().signal)).toEqual({
      kind: 'video',
      url: 'https://vt1.doubanio.com/a.mp4',
    })
    expect(fetchTrailer).toHaveBeenCalledWith('1', 'tv')

    const none = doubanPreviewSource(
      { url: 'https://movie.douban.com/subject/2/' },
      fetchTrailer
    )!
    expect(await none.resolve(new AbortController().signal)).toBeNull()
    expect(fetchTrailer).toHaveBeenLastCalledWith('2', 'movie')
    expect(
      doubanPreviewSource({ url: 'https://x.test/1' }, fetchTrailer)
    ).toBeNull()
  })
})

describe('海报墙的预览来源', () => {
  const deps = {
    videoUrl: (v: { fileId: number; path: string }) => `local://${v.fileId}`,
    image: (url: string) => (url.includes('bad') ? null : `thumb:${url}`),
  }

  it('本地视频：从 10% 处起播 6 秒，图片作为播不了时的备用', async () => {
    const { previewMedia } =
      await import('../src/renderer/src/features/library/wall/wall-preview')
    expect(
      previewMedia(
        { video: { fileId: 3, path: '/m/a.mkv' }, images: ['i1', 'bad'] },
        deps
      )
    ).toEqual({
      kind: 'video',
      url: 'local://3',
      startRatio: 0.1,
      clipSeconds: 6,
      fallback: ['thumb:i1'],
    })
  })

  it('网络路径：只轮播图片，不拉视频；什么都没有保持静态', async () => {
    const { previewMedia } =
      await import('../src/renderer/src/features/library/wall/wall-preview')
    expect(previewMedia({ video: null, images: ['i1', 'i2'] }, deps)).toEqual({
      kind: 'images',
      urls: ['thumb:i1', 'thumb:i2'],
    })
    expect(previewMedia({ video: null, images: [] }, deps)).toBeNull()
    expect(previewMedia(null, deps)).toBeNull()
  })

  it('悬停满延时才向片库要预览（resolve 时才调用 getPreview）', async () => {
    const { wallPreviewSource } =
      await import('../src/renderer/src/features/library/wall/wall-preview')
    const getPreview = vi.fn(
      async (): Promise<ItemPreview> => ({ video: null, images: ['i1'] })
    )
    const source = wallPreviewSource(
      { id: 42 } as Parameters<typeof wallPreviewSource>[0],
      { ...deps, getPreview }
    )
    expect(source.key).toBe('library:42')
    expect(getPreview).not.toHaveBeenCalled()
    await source.resolve(new AbortController().signal)
    expect(getPreview).toHaveBeenCalledWith(42)
  })
})

describe('UiPosterCard', () => {
  it('给了预览来源才渲染预览层', async () => {
    const { default: UiPosterCard } =
      await import('../src/renderer/src/components/ui/UiPosterCard.vue')
    const plain = await renderToString(h(UiPosterCard, { title: '片名' }))
    expect(plain).not.toContain('ui-preview-layer')
    const withPreview = await renderToString(
      h(UiPosterCard, {
        title: '片名',
        cover: 'https://x/c.jpg',
        preview: { key: 'k', resolve: async () => null },
      })
    )
    expect(withPreview).toContain('ui-preview-layer')
  })
})

describe('外观设置', () => {
  let values: ReturnType<typeof defaultValues>
  beforeEach(() => {
    vi.resetModules()
    values = defaultValues()
    vi.stubGlobal('window', {
      api: {
        settings: {
          snapshot: () => ({
            values,
            secrets: { 'scrape.tmdbToken': false },
            legacyMigrated: true,
          }),
          onChanged: () => {},
          onSecretChanged: () => {},
          set: async () => {},
        },
      },
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    })
    vi.stubGlobal('document', {
      documentElement: { dataset: {}, setAttribute: () => {} },
    })
  })

  const render = async (): Promise<string> => {
    const { default: Appearance } =
      await import('../src/renderer/src/features/settings/sections/AppearanceSettings.vue')
    return renderToString(h(Appearance))
  }

  it('开关开着时显示等待时间（短 / 标准 / 长，当前 600 为标准）', async () => {
    const html = await render()
    expect(html).toContain('悬停播放预览')
    expect(html).toContain('等待时间')
    expect(html).toMatch(/is-active[^>]*>[\s\S]*?标准/)
  })

  it('关掉后不显示等待时间', async () => {
    values = { ...defaultValues(), 'ui.hoverPreview': false }
    const html = await render()
    expect(html).toContain('悬停播放预览')
    expect(html).not.toContain('等待时间')
  })
})
