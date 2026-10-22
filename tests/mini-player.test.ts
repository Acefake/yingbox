// @vitest-environment jsdom
import {
  type Component,
  KeepAlive,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
} from 'vue'
import {
  RouterView,
  createMemoryHistory,
  createRouter,
  useRoute,
} from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 应用内小窗：页内播放器在离开详情时把同一个 <video>（同一 Artplayer / hls 会话）搬进右下角小窗，
 * 回到详情时认领回来；暂停中离开、换别的条目、显式关闭、设置关闭时正常拆除。
 *
 * Artplayer / hls.js 换成记数的替身：判据是「构造次数、loadSource 次数不变，<video> 是同一个元素」。
 */

const fakes = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void
  const arts: FakeArt[] = []
  const hlsList: FakeHls[] = []
  class FakeArt {
    option: Record<string, unknown>
    video: HTMLVideoElement
    template: { $player: HTMLElement; $container: HTMLElement }
    destroyed = 0
    notice = { show: '' }
    subtitle = { switch: async (): Promise<void> => {} }
    private handlers = new Map<string, Handler[]>()
    constructor(option: Record<string, unknown>) {
      this.option = option
      const container = option.container as HTMLElement
      const player = document.createElement('div')
      player.className = 'art-video-player'
      this.video = document.createElement('video')
      player.appendChild(this.video)
      container.appendChild(player)
      this.template = { $player: player, $container: container }
      arts.push(this)
      const custom = option.customType as
        | { m3u8?: (v: HTMLVideoElement, url: string, art: FakeArt) => void }
        | undefined
      if (option.type === 'm3u8' && custom?.m3u8)
        custom.m3u8(this.video, option.url as string, this)
    }
    on(name: string, fn: Handler): void {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn])
    }
    emit(name: string, ...args: unknown[]): void {
      for (const fn of this.handlers.get(name) ?? []) fn(...args)
    }
    destroy(): void {
      this.destroyed++
      this.emit('destroy')
    }
  }
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' }
    static isSupported(): boolean {
      return true
    }
    loads: string[] = []
    destroyed = 0
    media: HTMLVideoElement | null = null
    constructor() {
      hlsList.push(this)
    }
    loadSource(url: string): void {
      this.loads.push(url)
    }
    attachMedia(el: HTMLVideoElement): void {
      this.media = el
    }
    on(): void {}
    destroy(): void {
      this.destroyed++
    }
  }
  return { arts, hlsList, FakeArt, FakeHls }
})

vi.mock('artplayer', () => ({ default: fakes.FakeArt }))
vi.mock('hls.js', () => ({ default: fakes.FakeHls }))

const SRC = 'https://cdn.example/a/index.m3u8'
const OTHER = 'https://cdn.example/b/index.m3u8'

/** jsdom 的 <video> 永远是暂停态：按需改成播放中 */
function setPlaying(video: HTMLVideoElement, playing = true): void {
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => !playing,
  })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

let dock: typeof import('../src/renderer/src/features/player/mini/mini-dock')
let settings: typeof import('../src/renderer/src/features/settings')

beforeEach(async () => {
  vi.resetModules()
  fakes.arts.length = 0
  fakes.hlsList.length = 0
  localStorage.clear()
  document.body.innerHTML = ''
  dock = await import('../src/renderer/src/features/player/mini/mini-dock')
  settings = await import('../src/renderer/src/features/settings')
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** 一个最小会话：节点里放一个 <video> */
function makeSession(
  key: string,
  over: Partial<import('../src/renderer/src/features/player/mini/mini-dock').MiniSession> = {}
): import('../src/renderer/src/features/player/mini/mini-dock').MiniSession {
  const node = document.createElement('div')
  const video = document.createElement('video')
  video.controls = true
  node.appendChild(video)
  document.body.appendChild(node)
  setPlaying(video)
  return {
    key,
    title: key,
    node,
    video,
    restore: vi.fn(),
    teardown: vi.fn(),
    ...over,
  }
}

function mountSlot(): HTMLElement {
  const slot = document.createElement('div')
  slot.className = 'test-slot'
  document.body.appendChild(slot)
  dock.setMiniSlot(slot)
  return slot
}

describe('设置项 ui.miniPlayer', () => {
  it('默认开启，只接受布尔值', async () => {
    const { defaultValues, parseSetting } =
      await import('../src/shared/settings/schema')
    expect(defaultValues()['ui.miniPlayer']).toBe(true)
    expect(parseSetting('ui.miniPlayer', false)).toEqual({
      key: 'ui.miniPlayer',
      value: false,
    })
    expect(parseSetting('ui.miniPlayer', 'no')).toBeUndefined()
  })
})

describe('小窗交接规则（mini-dock）', () => {
  it('播放中离开：节点原样搬进小窗，<video> 还是同一个元素', () => {
    const slot = mountSlot()
    const s = makeSession(SRC)
    expect(dock.dockMini(s)).toBe(true)
    expect(slot.firstChild).toBe(s.node)
    expect(slot.querySelector('video')).toBe(s.video)
    expect(dock.miniSession().value).toBe(s)
    expect(s.teardown).not.toHaveBeenCalled()
  })

  it('暂停中、已播完、设置关闭、没有小窗挂载点：都不搬', async () => {
    mountSlot()
    const paused = makeSession(SRC)
    setPlaying(paused.video, false)
    expect(dock.dockMini(paused)).toBe(false)

    const ended = makeSession(SRC)
    Object.defineProperty(ended.video, 'ended', { get: () => true })
    expect(dock.dockMini(ended)).toBe(false)

    await settings.setSetting('ui.miniPlayer', false)
    const off = makeSession(SRC)
    expect(dock.dockMini(off)).toBe(false)
    await settings.setSetting('ui.miniPlayer', true)

    dock.setMiniSlot(null)
    const noSlot = makeSession(SRC)
    expect(dock.dockMini(noSlot)).toBe(false)
    for (const s of [paused, ended, off, noSlot]) {
      expect(s.node.parentElement).toBe(document.body)
      expect(s.teardown).not.toHaveBeenCalled()
    }
    expect(dock.miniSession().value).toBeNull()
  })

  it('认领：同一 key 取回同一会话并清空小窗；不同 key 认领不到', () => {
    mountSlot()
    const s = makeSession(SRC)
    dock.dockMini(s)
    expect(dock.claimMini(OTHER)).toBeNull()
    expect(dock.miniSession().value).toBe(s)
    expect(dock.claimMini(SRC)).toBe(s)
    expect(dock.miniSession().value).toBeNull()
    expect(s.teardown).not.toHaveBeenCalled()
  })

  it('小窗里隐藏原生控制条，认领时还原', () => {
    mountSlot()
    const s = makeSession(SRC)
    dock.dockMini(s)
    expect(s.video.controls).toBe(false)
    dock.claimMini(SRC)
    expect(s.video.controls).toBe(true)
  })

  it('换别的条目（preempt 另一个 key）：拆除一次；同一 key 不拆', () => {
    mountSlot()
    const s = makeSession(SRC)
    dock.dockMini(s)
    dock.preemptMini(SRC)
    expect(s.teardown).not.toHaveBeenCalled()
    dock.preemptMini(OTHER)
    expect(s.teardown).toHaveBeenCalledTimes(1)
    expect(s.node.isConnected).toBe(false)
    expect(dock.miniSession().value).toBeNull()
  })

  it('小窗里再搬进另一个会话：先拆旧的', () => {
    mountSlot()
    const a = makeSession(SRC)
    const b = makeSession(OTHER)
    dock.dockMini(a)
    dock.dockMini(b)
    expect(a.teardown).toHaveBeenCalledTimes(1)
    expect(dock.miniSession().value).toBe(b)
  })

  it('显式关闭：拆除一次、节点移出；回到详情：调 restore，会话留到被认领', () => {
    mountSlot()
    const s = makeSession(SRC)
    dock.dockMini(s)
    dock.returnFromMini()
    expect(s.restore).toHaveBeenCalledTimes(1)
    expect(dock.miniSession().value).toBe(s)
    dock.closeMini()
    dock.closeMini()
    expect(s.teardown).toHaveBeenCalledTimes(1)
    expect(s.node.isConnected).toBe(false)
    expect(dock.miniSession().value).toBeNull()
  })
})

describe('小窗吸附四角', () => {
  it('松手时吸到离中心点最近的角', async () => {
    const { nearestCorner } =
      await import('../src/renderer/src/features/player/mini/snap')
    const view = { width: 1000, height: 800 }
    expect(nearestCorner({ x: 900, y: 700 }, view)).toBe('bottom-right')
    expect(nearestCorner({ x: 100, y: 700 }, view)).toBe('bottom-left')
    expect(nearestCorner({ x: 100, y: 100 }, view)).toBe('top-left')
    expect(nearestCorner({ x: 600, y: 300 }, view)).toBe('top-right')
  })
})

// ── 接入：真 UnifiedVideoPlayer + 宿主 + 路由（keep-alive）+ 小窗组件 ──────────

interface Harness {
  router: ReturnType<typeof createRouter>
  host: { show: { value: boolean }; src: { value: string }; leave: () => void }
  events: { close: number; play: number; ready: number }
  root: HTMLElement
  unmount: () => void
}

async function mountHarness(): Promise<Harness> {
  const { default: UnifiedVideoPlayer } =
    await import('../src/renderer/src/features/player/components/UnifiedVideoPlayer.vue')
  const { provideMiniHost } =
    await import('../src/renderer/src/features/player/mini/mini-host')
  const { default: MiniPlayer } =
    await import('../src/renderer/src/features/player/mini/MiniPlayer.vue')

  const events = { close: 0, play: 0, ready: 0 }
  const host = {} as Harness['host']
  const Detail = defineComponent({
    name: 'DetailPage',
    setup() {
      const route = useRoute()
      const show = ref(true)
      const src = ref(SRC)
      const mini = provideMiniHost({ capture: () => () => {} })
      Object.assign(host, { show, src, leave: mini.leave, route })
      return () =>
        show.value
          ? h(UnifiedVideoPlayer as Component, {
              src: src.value,
              title: '片名',
              onClose: () => {
                events.close++
                show.value = false
              },
              onPlay: () => events.play++,
              onReady: () => events.ready++,
            })
          : h('p', '详情')
    },
  })
  const Elsewhere = defineComponent({ setup: () => () => h('p', '别处') })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/detail', component: Detail },
      { path: '/elsewhere', component: Elsewhere },
    ],
  })
  const App = defineComponent({
    setup: () => () => [
      h(RouterView, null, {
        default: ({ Component: C }: { Component: Component }) =>
          h(KeepAlive, null, [C ? h(C) : null]),
      }),
      h(MiniPlayer as Component),
    ],
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App).use(router)
  await router.push('/detail')
  await router.isReady()
  app.mount(root)
  await settle()
  return { router, host, events, root, unmount: () => app.unmount() }
}

const miniSlot = (): HTMLElement | null =>
  document.querySelector('[data-mini-slot]')

describe('UnifiedVideoPlayer 交接', () => {
  it('播放中切走路由：同一 <video> 搬进小窗；回来认领回详情；Artplayer / Hls 都不重建', async () => {
    const t = await mountHarness()
    expect(fakes.arts).toHaveLength(1)
    const art = fakes.arts[0]
    const video = art.video
    setPlaying(video)
    expect(fakes.hlsList).toHaveLength(1)
    expect(fakes.hlsList[0].loads).toEqual([SRC])

    await t.router.push('/elsewhere')
    await settle()
    expect(miniSlot()?.contains(video)).toBe(true)
    expect(video.isConnected).toBe(true)
    expect(art.destroyed).toBe(0)

    await t.router.push('/detail')
    await settle()
    expect(miniSlot()?.contains(video)).toBe(false)
    expect(t.root.contains(video)).toBe(true)
    expect(fakes.arts).toHaveLength(1)
    expect(fakes.hlsList).toHaveLength(1)
    expect(fakes.hlsList[0].loads).toEqual([SRC])
    expect(fakes.hlsList[0].destroyed).toBe(0)
    expect(fakes.hlsList[0].media).toBe(video)
    expect(dock.miniSession().value).toBeNull()
    t.unmount()
  })

  it('暂停中切走路由：不进小窗，回来还在原处', async () => {
    const t = await mountHarness()
    const video = fakes.arts[0].video
    await t.router.push('/elsewhere')
    await settle()
    expect(miniSlot()?.contains(video)).toBe(false)
    expect(dock.miniSession().value).toBeNull()
    await t.router.push('/detail')
    await settle()
    expect(t.root.contains(video)).toBe(true)
    expect(fakes.arts).toHaveLength(1)
    t.unmount()
  })

  it('关闭详情（leave 后卸载）：搬进小窗；重新打开同一地址：新组件认领同一实例，事件转给新组件', async () => {
    const t = await mountHarness()
    const art = fakes.arts[0]
    setPlaying(art.video)
    t.host.leave()
    t.host.show.value = false
    await settle()
    expect(miniSlot()?.contains(art.video)).toBe(true)
    expect(art.destroyed).toBe(0)
    expect(fakes.hlsList[0].destroyed).toBe(0)

    t.host.show.value = true
    await settle()
    expect(fakes.arts).toHaveLength(1)
    expect(fakes.hlsList).toHaveLength(1)
    expect(fakes.hlsList[0].loads).toEqual([SRC])
    expect(t.root.contains(art.video)).toBe(true)
    expect(miniSlot()?.contains(art.video)).toBe(false)

    const before = t.events.play
    art.emit('video:play', new Event('play'))
    expect(t.events.play).toBe(before + 1)
    t.unmount()
  })

  it('显式关闭（没有 leave 就卸载）：正常拆除 Artplayer 与 Hls', async () => {
    const t = await mountHarness()
    const art = fakes.arts[0]
    setPlaying(art.video)
    t.host.show.value = false
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(art.destroyed).toBe(1)
    expect(fakes.hlsList[0].destroyed).toBeGreaterThan(0)
    expect(art.video.isConnected).toBe(false)
    t.unmount()
  })

  it('小窗里点关闭：拆除，并让还缓存着的详情收到 close', async () => {
    const t = await mountHarness()
    const art = fakes.arts[0]
    setPlaying(art.video)
    await t.router.push('/elsewhere')
    await settle()
    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="关闭小窗"]'
    )
    expect(close).not.toBeNull()
    close!.click()
    await settle()
    expect(art.destroyed).toBe(1)
    expect(t.events.close).toBe(1)
    expect(miniSlot()?.contains(art.video)).toBe(false)
    expect(document.querySelector('[aria-label="关闭小窗"]')).toBeNull()
    t.unmount()
  })

  it('回到详情按钮：调宿主的恢复（回到原路由）并认领回去', async () => {
    const t = await mountHarness()
    const art = fakes.arts[0]
    setPlaying(art.video)
    await t.router.push('/elsewhere')
    await settle()
    document
      .querySelector<HTMLButtonElement>('[aria-label="回到详情"]')!
      .click()
    await settle()
    expect(t.router.currentRoute.value.path).toBe('/detail')
    expect(t.root.querySelector('.unified-player')?.contains(art.video)).toBe(
      true
    )
    expect(fakes.arts).toHaveLength(1)
    expect(dock.miniSession().value).toBeNull()
    t.unmount()
  })

  it('换别的条目：详情里改地址 → 小窗里的旧会话拆除', async () => {
    const t = await mountHarness()
    const art = fakes.arts[0]
    setPlaying(art.video)
    t.host.leave()
    t.host.show.value = false
    await settle()
    expect(dock.miniSession().value).not.toBeNull()
    t.host.src.value = OTHER
    t.host.show.value = true
    await settle()
    expect(art.destroyed).toBe(1)
    expect(dock.miniSession().value).toBeNull()
    expect(fakes.arts).toHaveLength(2)
    expect(fakes.hlsList.at(-1)?.loads).toEqual([OTHER])
    t.unmount()
  })

  it('设置关闭小窗：离开时不搬；小窗开着时关掉设置 → 立即拆除', async () => {
    const t = await mountHarness()
    const art = fakes.arts[0]
    setPlaying(art.video)
    t.host.leave()
    t.host.show.value = false
    await settle()
    expect(dock.miniSession().value).not.toBeNull()
    await settings.setSetting('ui.miniPlayer', false)
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(art.destroyed).toBe(1)

    t.host.show.value = true
    await settle()
    const second = fakes.arts.at(-1)!
    setPlaying(second.video)
    await t.router.push('/elsewhere')
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(miniSlot()?.contains(second.video)).toBe(false)
    t.unmount()
  })

  it('小窗的播放 / 暂停按钮控制同一个 <video>', async () => {
    const t = await mountHarness()
    const video = fakes.arts[0].video
    setPlaying(video)
    const pause = vi.fn()
    video.pause = pause
    await t.router.push('/elsewhere')
    await settle()
    document
      .querySelector<HTMLButtonElement>('[aria-label="暂停"]')!
      .click()
    expect(pause).toHaveBeenCalledTimes(1)
    t.unmount()
  })
})

describe('画中画按钮', () => {
  it('Artplayer 的画中画控件只在 document.pictureInPictureEnabled 时打开', async () => {
    const { artOptions } =
      await import('../src/renderer/src/features/player/utils/art-options')
    const base = {
      container: document.createElement('div'),
      url: SRC,
      autoplay: true,
      controls: true,
      hls: null,
    }
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: false,
    })
    expect(artOptions(base).pip).toBe(false)
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    })
    expect(artOptions(base).pip).toBe(true)
  })
})
