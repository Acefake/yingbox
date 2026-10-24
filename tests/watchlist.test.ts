// @vitest-environment jsdom
// test-affected: repo-wide
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type App, createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  WATCHLIST_LIMIT,
  type WatchlistEntry,
  type WatchlistMeta,
  type WatchlistSection,
  addEntry,
  entriesFor,
  entryImage,
  hasEntry,
  removeEntry,
  sanitizeEntries,
  toggleEntry,
} from '../src/renderer/src/features/watchlist/watchlist-rules'

/**
 * 「想看」清单：纯规则（加入 / 移除 / 切换 / 板块过滤 / 校验）、存储与跨窗口同步、
 * 整部看完自动移出（复用继续播放的完成判定）、横排组件（右键移除、点卡打开详情），以及各入口的接线。
 */

// 播放器公共出口很重（弹窗组件）：换成继续播放的存取模块本身（测试也经它开播 / 记进度，保证是同一份实例）
vi.mock('@/features/player', async () => {
  const store =
    await import('../src/renderer/src/features/player/continue/continue-store')
  return { ...store }
})

type ContinueStore =
  typeof import('../src/renderer/src/features/player/continue/continue-store')

const meta = (
  section: WatchlistSection,
  key: string,
  extra = {}
): WatchlistMeta => ({
  section,
  key,
  title: `片 ${key}`,
  ...extra,
})

describe('watchlist-rules', () => {
  it('加入 / 已存在时移到最前 / 切换移除', () => {
    let list: WatchlistEntry[] = []
    list = addEntry(list, meta('online', '繁花'), 1)
    list = addEntry(list, meta('movie', '7'), 2)
    expect(list.map(e => e.id)).toEqual(['movie:7', 'online:繁花'])
    list = addEntry(list, meta('online', '繁花', { poster: 'p.jpg' }), 3)
    expect(list.map(e => e.id)).toEqual(['online:繁花', 'movie:7'])
    expect(list[0]).toMatchObject({ poster: 'p.jpg', addedAt: 3 })
    expect(hasEntry(list, 'movie', '7')).toBe(true)
    list = toggleEntry(list, meta('movie', '7'), 4)
    expect(hasEntry(list, 'movie', '7')).toBe(false)
    list = toggleEntry(list, meta('movie', '7'), 5)
    expect(list[0].id).toBe('movie:7')
  })

  it('移除不存在的 id 返回同一个数组；超过上限丢最早的', () => {
    const list = addEntry([], meta('tv', '1'), 1)
    expect(removeEntry(list, 'tv:2')).toBe(list)
    let many: WatchlistEntry[] = []
    for (let i = 0; i <= WATCHLIST_LIMIT; i++)
      many = addEntry(many, meta('movie', String(i)), i)
    expect(many).toHaveLength(WATCHLIST_LIMIT)
    expect(hasEntry(many, 'movie', '0')).toBe(false)
  })

  it('板块过滤、海报优先、校验丢掉坏数据与重复 id', () => {
    const list = [
      addEntry([], meta('tv', '1', { cover: 'c.jpg' }), 1)[0],
      addEntry([], meta('movie', '2', { poster: 'p.jpg', cover: 'c' }), 2)[0],
    ]
    expect(entriesFor(list, 'tv').map(e => e.key)).toEqual(['1'])
    expect(entryImage(list[0])).toBe('c.jpg')
    expect(entryImage(list[1])).toBe('p.jpg')
    expect(
      sanitizeEntries([list[0], list[0], { id: 1 }, null, 'x', list[1]])
    ).toEqual([list[0], list[1]])
    expect(sanitizeEntries({})).toEqual([])
  })
})

describe('watchlist-store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  async function stores(): Promise<{
    watch: typeof import('../src/renderer/src/features/watchlist/watchlist-store')
    cont: ContinueStore
  }> {
    return {
      watch:
        await import('../src/renderer/src/features/watchlist/watchlist-store'),
      cont: (await import('@/features/player')) as unknown as ContinueStore,
    }
  }

  it('切换写入 localStorage（watchlist），载荷转成普通 JSON', async () => {
    const { watch } = await stores()
    const { reactive } = await import('vue')
    const detail = reactive({ vod_name: '繁花' })
    expect(watch.toggleWatchlist(meta('online', '繁花', { detail }))).toBe(true)
    expect(watch.inWatchlist('online', '繁花')).toBe(true)
    const saved = JSON.parse(localStorage.getItem('watchlist') || '[]')
    expect(saved[0]).toMatchObject({
      id: 'online:繁花',
      detail: { vod_name: '繁花' },
    })
    expect(watch.toggleWatchlist(meta('online', '繁花'))).toBe(false)
    expect(JSON.parse(localStorage.getItem('watchlist') || '')).toEqual([])
  })

  it('其它窗口改了存储时同步', async () => {
    const { watch } = await stores()
    const list = watch.watchlistEntries()
    expect(list.value).toEqual([])
    const value = JSON.stringify(addEntry([], meta('tv', '9'), 1))
    localStorage.setItem('watchlist', value)
    window.dispatchEvent(new StorageEvent('storage', { key: 'watchlist' }))
    expect(list.value.map(e => e.id)).toEqual(['tv:9'])
  })

  it('开始播放不移除；看完 95% 的单片自动移出', async () => {
    const { watch, cont } = await stores()
    watch.installWatchlist()
    watch.installWatchlist()
    watch.toggleWatchlist(meta('movie', '7'))
    const id = cont.startContinue(meta('movie', '7'), { filePath: '/m/7.mkv' })
    cont.updateContinue(id, { index: 0, progress: 600, duration: 6000 })
    expect(watch.inWatchlist('movie', '7')).toBe(true)
    cont.updateContinue(id, { index: 0, progress: 5800, duration: 6000 })
    expect(watch.inWatchlist('movie', '7')).toBe(false)
  })

  it('剧集看完中间一集不移除，最后一集看完才移出', async () => {
    const { watch, cont } = await stores()
    watch.installWatchlist()
    watch.toggleWatchlist(meta('online', '繁花'))
    const playlist = [
      { url: 'https://a/1.m3u8', name: '第1集' },
      { url: 'https://a/2.m3u8', name: '第2集' },
    ]
    const id = cont.startContinue(meta('online', '繁花'), {
      playlist,
      index: 0,
    })
    cont.updateContinue(id, {
      index: 0,
      progress: 100,
      duration: 100,
      ended: true,
    })
    expect(watch.inWatchlist('online', '繁花')).toBe(true)
    cont.updateContinue(id, { index: 1, progress: 99, duration: 100 })
    expect(watch.inWatchlist('online', '繁花')).toBe(false)
  })

  it('手动移除继续播放记录不算看完', async () => {
    const { watch, cont } = await stores()
    watch.installWatchlist()
    watch.toggleWatchlist(meta('tv', '3'))
    const id = cont.startContinue(meta('tv', '3'), { filePath: '/t/3.mkv' })
    cont.removeContinue(id)
    expect(watch.inWatchlist('tv', '3')).toBe(true)
  })
})

describe('WatchlistRow', () => {
  let app: App | null = null
  let host: HTMLElement

  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    app?.unmount()
    app = null
    host?.remove()
    document.body.innerHTML = ''
  })

  async function mount(
    section: WatchlistSection,
    onOpen = vi.fn()
  ): Promise<HTMLElement> {
    const { default: WatchlistRow } =
      await import('../src/renderer/src/features/watchlist/WatchlistRow.vue')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(WatchlistRow, { section, onOpen }) })
    app.mount(host)
    await nextTick()
    return host
  }

  function seed(): void {
    let list: WatchlistEntry[] = []
    list = addEntry(
      list,
      meta('online', '繁花', { detail: { vod_name: '繁花' } }),
      1
    )
    list = addEntry(list, meta('online', '漫长的季节'), 2)
    list = addEntry(list, meta('movie', '1'), 3)
    localStorage.setItem('watchlist', JSON.stringify(list))
  }

  it('没有条目不渲染；只列本板块，最近加入的在前', async () => {
    const empty = await mount('online')
    expect(empty.querySelector('.wl-row')).toBeNull()
    app?.unmount()
    seed()
    vi.resetModules()
    const el = await mount('online')
    const names = [...el.querySelectorAll('.wl-name')].map(n => n.textContent)
    expect(names).toEqual(['片 漫长的季节', '片 繁花'])
  })

  it('点卡片打开详情；右键菜单移除', async () => {
    seed()
    const onOpen = vi.fn()
    const el = await mount('online', onOpen)
    ;(el.querySelectorAll('.wl-thumb')[1] as HTMLElement).click()
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'online:繁花',
        detail: { vod_name: '繁花' },
      })
    )
    el.querySelectorAll('.wl-card')[1].dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })
    )
    await nextTick()
    const items = [...document.querySelectorAll('.wl-menu [role="menuitem"]')]
    expect(items.map(i => i.textContent?.trim())).toEqual([
      '打开详情',
      '从想看中移除',
    ])
    ;(items[1] as HTMLElement).click()
    await nextTick()
    expect(el.querySelectorAll('.wl-card')).toHaveLength(1)
    expect(document.querySelector('.wl-menu')).toBeNull()
  })
})

describe('接线（源码）', () => {
  const src = (path: string): string =>
    readFileSync(join(__dirname, '../src/renderer/src', path), 'utf8')

  it('在线 / 媒体库详情有想看按钮，键与继续播放一致', () => {
    const online = src('features/online/components/DetailWindow.vue')
    expect(online).toContain('<WatchlistButton :meta="watchlistMeta" />')
    expect(online).toMatch(/section: 'online',\s+key: itemName\.value,/)
    expect(src('features/library/detail/DetailHero.vue')).toContain(
      '<WatchlistButton :meta="watchlistMeta" />'
    )
    expect(src('features/library/detail/playback.ts')).toMatch(
      /watchlistMetaOf[\s\S]+continueMetaOf\(item\)/
    )
    const button = src('features/watchlist/WatchlistButton.vue')
    expect(button).toContain('<UiIconButton')
    expect(button).toContain('icon="bookmark"')
  })

  it('在线首页与媒体库分区在继续播放下面放想看横排；应用入口订阅看完', () => {
    const online = src('features/online/views/OnlineView.vue')
    expect(online.indexOf('<WatchlistRow')).toBeGreaterThan(
      online.indexOf('<ContinueRow')
    )
    const rows = src('features/library/page/LibraryTopRows.vue')
    expect(rows.indexOf('<WatchlistRow')).toBeGreaterThan(
      rows.indexOf('<ContinueRow')
    )
    expect(src('features/library/LibraryPage.vue')).toContain('<LibraryTopRows')
    expect(src('main.ts')).toContain('installWatchlist()')
  })
})
