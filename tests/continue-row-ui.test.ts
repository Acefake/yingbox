// @vitest-environment jsdom
import { type App, createApp, h, nextTick } from 'vue'
import type ContinueRowComponent from '../src/renderer/src/features/player/continue/ContinueRow.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 「继续播放」横排（真组件）：没有记录不渲染、只列本板块、点卡续播、移除、右键菜单、
 * 板块自己的续播方式、打开详情只在页面监听 detail 时出现。
 */

const openMediaPlayer = vi.fn(async () => true)
vi.mock(
  '../src/renderer/src/features/player/composables/use-media-player',
  () => ({ openMediaPlayer })
)

const STORAGE_KEY = 'continue_watching'

function seed(): void {
  const record = (
    section: string,
    key: string,
    title: string
  ): Record<string, unknown> => ({
    id: `${section}:${key}`,
    section,
    key,
    title,
    cover: '',
    detail: { itemId: Number(key) },
    replay: { filePath: `/m/${key}.mkv` },
    progress: 600,
    duration: 2400,
    updatedAt: Date.now(),
  })
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      record('movie', '1', '沙丘'),
      record('movie', '2', '奥本海默'),
      record('tv', '3', '繁花'),
    ])
  )
}

let app: App | null = null
let host: HTMLElement

async function mount(
  props: InstanceType<typeof ContinueRowComponent>['$props'],
  onOuterEscape?: () => void
): Promise<HTMLElement> {
  vi.resetModules()
  const { default: ContinueRow } =
    await import('../src/renderer/src/features/player/continue/ContinueRow.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  const { useEscapeLayer } =
    await import('../src/renderer/src/composables/use-escape-layer')
  app = createApp({
    setup() {
      if (onOuterEscape) useEscapeLayer(() => true, onOuterEscape)
      return () => h(ContinueRow, props)
    },
  })
  app.mount(host)
  await nextTick()
  return host
}

beforeEach(() => {
  localStorage.clear()
  openMediaPlayer.mockClear()
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('继续播放横排', () => {
  it('没有记录时整块不渲染', async () => {
    const el = await mount({ section: 'movie' })
    expect(el.querySelector('.cw-row')).toBeNull()
  })

  it('只列本板块的记录，显示剩余时间', async () => {
    seed()
    const el = await mount({ section: 'movie' })
    const names = [...el.querySelectorAll('.cw-name')].map(n => n.textContent)
    expect(names).toEqual(['沙丘', '奥本海默'])
    expect(el.querySelector('.cw-left')?.textContent).toBe('剩 30 分钟')
  })

  it('点卡片按记录续播（带 continueAs），移除后卡片消失', async () => {
    seed()
    const el = await mount({ section: 'movie' })
    ;(el.querySelector('.cw-thumb') as HTMLElement).click()
    await nextTick()
    expect(openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/m/1.mkv',
        title: '沙丘',
        startAt: 600,
        continueAs: expect.objectContaining({ section: 'movie', key: '1' }),
      })
    )
    ;(el.querySelector('.cw-remove') as HTMLElement).click()
    await nextTick()
    expect(el.querySelectorAll('.cw-card')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')).toHaveLength(
      2
    )
  })

  it('右键菜单：从头播放；没有监听 detail 时不出「打开详情」', async () => {
    seed()
    const el = await mount({ section: 'movie' })
    el.querySelector('.cw-card')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })
    )
    await nextTick()
    const items = [...document.querySelectorAll('.cw-menu [role="menuitem"]')]
    expect(items.map(i => i.textContent?.trim())).toEqual([
      '继续播放 · 10:00',
      '从头播放',
      '标记为已看完',
      '从继续播放中移除',
    ])
    ;(items[1] as HTMLElement).click()
    await nextTick()
    expect(openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ startAt: 0 })
    )
    expect(document.querySelector('.cw-menu')).toBeNull()
  })

  it('输入法组字中的 Esc 不关菜单，普通 Esc 一次只关闭最上层', async () => {
    seed()
    const closeOuter = vi.fn()
    const el = await mount({ section: 'movie' }, closeOuter)
    el.querySelector('.cw-card')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true })
    )
    await nextTick()
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        isComposing: true,
        cancelable: true,
      })
    )
    await nextTick()
    expect(document.querySelector('.cw-menu')).not.toBeNull()
    expect(closeOuter).not.toHaveBeenCalled()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    )
    await nextTick()
    expect(document.querySelector('.cw-menu')).toBeNull()
    expect(closeOuter).not.toHaveBeenCalled()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    )
    expect(closeOuter).toHaveBeenCalledOnce()
  })

  it('页面监听 detail 时菜单有「打开详情」；板块自己的 resume 优先', async () => {
    seed()
    const onDetail = vi.fn()
    const resume = vi.fn(async () => true)
    const el = await mount({ section: 'tv', onDetail, resume })
    ;(el.querySelector('.cw-thumb') as HTMLElement).click()
    await nextTick()
    expect(resume).toHaveBeenCalledWith(
      expect.objectContaining({ key: '3' }),
      false
    )
    expect(openMediaPlayer).not.toHaveBeenCalled()
    el.querySelector('.cw-card')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true })
    )
    await nextTick()
    const detail = [
      ...document.querySelectorAll<HTMLElement>('.cw-menu [role="menuitem"]'),
    ].find(i => i.textContent?.trim() === '打开详情')
    detail!.click()
    expect(onDetail).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { itemId: 3 } })
    )
  })
})
