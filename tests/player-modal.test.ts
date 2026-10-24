// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 测试里就地拼宿主页面 */
import { type Component, createApp, defineComponent, h, nextTick } from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 应用内播放弹窗与小窗：所有入口经 openMediaPlayer 打开同一个弹窗（桌面与网页一样），
 * Esc / 关闭按钮关掉并保存进度、拆除 Artplayer 与 hls；缩成角落小窗时同一个 <video> 原样搬过去，
 * 展开时搬回来；切路由时弹窗自动缩成小窗，小窗跨路由保持。
 *
 * Artplayer / hls.js 换成记数的替身：判据是「构造次数、loadSource 次数不变，<video> 是同一个元素」。
 */

const fakes = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void
  const arts: FakeArt[] = []
  const hlsList: FakeHls[] = []
  /** layers / controls / contextmenu 的最小桩：add 返回一个元素并记下名字 */
  class FakeComponent {
    show = false
    names: string[] = []
    add(option: { name?: string }): HTMLElement {
      this.names.push(option.name ?? '')
      return document.createElement('div')
    }
    remove(name: string): void {
      this.names = this.names.filter(n => n !== name)
    }
  }
  class FakeArt {
    option: Record<string, unknown>
    video: HTMLVideoElement
    template: { $player: HTMLElement; $container: HTMLElement }
    destroyed = 0
    notice = { show: '' }
    subtitle = { switch: async (): Promise<void> => {} }
    layers = new FakeComponent()
    controls = new FakeComponent()
    contextmenu = new FakeComponent()
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
    config: Record<string, unknown>
    constructor(config: Record<string, unknown> = {}) {
      this.config = config
      hlsList.push(this)
    }
    loadSource(url: string): void {
      this.loads.push(url)
    }
    attachMedia(el: HTMLVideoElement): void {
      this.media = el
    }
    on(): void {
      // 替身不需要 hls 事件
    }
    destroy(): void {
      this.destroyed++
    }
  }
  return { arts, hlsList, FakeArt, FakeHls }
})

vi.mock('artplayer', () => ({ default: fakes.FakeArt }))
vi.mock('hls.js', async importOriginal => ({
  ...(await importOriginal<typeof import('hls.js')>()),
  default: fakes.FakeHls,
}))
// 播放会话只用到在线源的地址解析；替身原样返回地址
vi.mock('../src/renderer/src/features/online', () => ({
  resolvePlaySource: async (entry: { url?: string }) => entry.url ?? '',
}))

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
let player: typeof import('../src/renderer/src/features/player')

beforeEach(async () => {
  vi.resetModules()
  // jsdom 没实现媒体播放：停止 / 重载换成空操作，免得刷屏
  HTMLMediaElement.prototype.pause = (): void => {}
  HTMLMediaElement.prototype.load = (): void => {}
  fakes.arts.length = 0
  fakes.hlsList.length = 0
  localStorage.clear()
  document.body.innerHTML = ''
  dock = await import('../src/renderer/src/features/player/mini/mini-dock')
  settings = await import('../src/renderer/src/features/settings')
  player = await import('../src/renderer/src/features/player')
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** 一个最小会话：节点里放一个 <video> */
function makeSession(
  key: string,
  over: Partial<
    import('../src/renderer/src/features/player/mini/mini-dock').MiniSession
  > = {}
): import('../src/renderer/src/features/player/mini/mini-dock').MiniSession {
  const node = document.createElement('div')
  const video = document.createElement('video')
  node.appendChild(video)
  document.body.appendChild(node)
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
  it('交给小窗：节点原样搬进去，<video> 还是同一个元素；暂停中也搬', () => {
    const slot = mountSlot()
    const s = makeSession(SRC)
    expect(dock.dockMini(s)).toBe(true)
    expect(slot.firstChild).toBe(s.node)
    expect(slot.querySelector('video')).toBe(s.video)
    expect(dock.miniSession().value).toBe(s)
    expect(s.teardown).not.toHaveBeenCalled()
  })

  it('设置关闭、没有小窗挂载点：不搬', async () => {
    mountSlot()
    await settings.setSetting('ui.miniPlayer', false)
    const off = makeSession(SRC)
    expect(dock.dockMini(off)).toBe(false)
    await settings.setSetting('ui.miniPlayer', true)

    dock.setMiniSlot(null)
    const noSlot = makeSession(SRC)
    expect(dock.dockMini(noSlot)).toBe(false)
    for (const s of [off, noSlot]) {
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

  it('小窗里再搬进另一个会话：先拆旧的', () => {
    mountSlot()
    const a = makeSession(SRC)
    const b = makeSession(OTHER)
    dock.dockMini(a)
    dock.dockMini(b)
    expect(a.teardown).toHaveBeenCalledTimes(1)
    expect(dock.miniSession().value).toBe(b)
  })

  it('同一会话换了 <video>（连播下一集）：只换控制对象，不拆', () => {
    mountSlot()
    const s = makeSession(SRC)
    dock.dockMini(s)
    const next = document.createElement('video')
    dock.swapMiniVideo(OTHER, next)
    expect(dock.miniSession().value?.video).toBe(s.video)
    dock.swapMiniVideo(SRC, next)
    expect(dock.miniSession().value?.video).toBe(next)
    expect(dock.miniSession().value?.node).toBe(s.node)
    expect(s.teardown).not.toHaveBeenCalled()
  })

  it('显式关闭：拆除一次、节点移出；展开：调 restore，会话留到被认领', () => {
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

// ── 接入：真 PlayerModal + PlayerSession + UnifiedVideoPlayer + 小窗组件 + 路由 ──────────

interface Harness {
  router: ReturnType<typeof createRouter>
  root: HTMLElement
  unmount: () => void
}

async function mountApp(): Promise<Harness> {
  const { PlayerModal, MiniPlayer } = player
  const Page = (text: string): Component =>
    defineComponent({ setup: () => () => h('p', text) })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/a', component: Page('甲页') },
      { path: '/b', component: Page('乙页') },
    ],
  })
  const App = defineComponent({
    setup: () => () => [
      h(RouterView),
      h(MiniPlayer as Component),
      h(PlayerModal as Component),
    ],
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App).use(router)
  await router.push('/a')
  await router.isReady()
  app.mount(root)
  await settle()
  return { router, root, unmount: () => app.unmount() }
}

const modal = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
/** 弹窗是否显示（v-show 隐藏时 display: none） */
const modalVisible = (): boolean => {
  const el = modal()
  return Boolean(el && el.style.display !== 'none')
}

/** 隐藏有淡出过渡（jsdom 里没有样式，过渡在两帧后结束）：等它收起 */
async function hiddenSoon(): Promise<boolean> {
  await until(() => !modalVisible())
  return !modalVisible()
}

const miniSlot = (): HTMLElement | null =>
  document.querySelector('[data-mini-slot]')
const button = (label: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
const esc = (init: KeyboardEventInit = {}): void => {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, ...init })
  )
}

/** 让播放器收到一次 timeupdate（替身的事件没有 target，补上） */
function tick(art: InstanceType<typeof fakes.FakeArt>, at: number): void {
  Object.defineProperty(art.video, 'currentTime', {
    configurable: true,
    get: () => at,
  })
  Object.defineProperty(art.video, 'duration', {
    configurable: true,
    get: () => 600,
  })
  const event = new Event('timeupdate')
  Object.defineProperty(event, 'target', { value: art.video })
  art.emit('video:timeupdate', event)
}

async function openOne(
  options: Parameters<typeof player.openMediaPlayer>[0] = {
    url: SRC,
    title: '片名',
  }
): Promise<boolean> {
  const before = fakes.arts.length
  const ok = await player.openMediaPlayer(options)
  // 播放会话是按需加载的组件：第一次打开要等它加载完、建好播放器
  await until(() => fakes.arts.length > before)
  return ok
}

/** 等到条件成立（最多约 3 秒） */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !done(); i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await settle()
}

describe('播放弹窗', () => {
  it('openMediaPlayer 打开盖在页面上的弹窗（网页端没有 window.api 也一样），Artplayer 只建一次', async () => {
    const t = await mountApp()
    expect(await hiddenSoon()).toBe(true)
    expect(await openOne()).toBe(true)
    expect(modalVisible()).toBe(true)
    expect(fakes.arts).toHaveLength(1)
    expect(modal()?.contains(fakes.arts[0].video)).toBe(true)
    expect(fakes.hlsList[0].loads).toEqual([SRC])
    // 截图插件装上了：保存提示层、右键「截图」「截 GIF」
    expect(fakes.arts[0].layers.names).toContain('ybCaptureSaved')
    expect(fakes.arts[0].contextmenu.names).toEqual(
      expect.arrayContaining(['ybScreenshot', 'ybScreenshotGif'])
    )
    // 页面还在（弹窗只是盖在上面）
    expect(t.root.textContent).toContain('甲页')
    t.unmount()
  })

  it('Esc 关闭：保存进度、拆除 Artplayer 与 hls；输入法组字中的 Esc 不关', async () => {
    const t = await mountApp()
    await openOne()
    const art = fakes.arts[0]
    tick(art, 95)
    esc({ isComposing: true })
    esc({ keyCode: 229 })
    await settle()
    expect(modalVisible()).toBe(true)
    expect(art.destroyed).toBe(0)

    // 节流窗口内的最后位置要在关闭时补写
    tick(art, 130)
    esc()
    await settle()
    expect(await hiddenSoon()).toBe(true)
    expect(art.destroyed).toBe(1)
    expect(fakes.hlsList[0].destroyed).toBeGreaterThan(0)
    expect(art.video.isConnected).toBe(false)
    expect(player.getMediaProgress(SRC)).toBe(130)
    t.unmount()
  })

  it('关闭按钮同样拆除；点遮罩不关', async () => {
    const t = await mountApp()
    await openOne()
    modal()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(modalVisible()).toBe(true)
    button('关闭播放器')!.click()
    await settle()
    expect(await hiddenSoon()).toBe(true)
    expect(fakes.arts[0].destroyed).toBe(1)
    t.unmount()
  })

  it('缩成小窗（暂停中也行）：同一 <video> 搬进小窗、不重建；展开：搬回弹窗', async () => {
    const t = await mountApp()
    await openOne()
    const art = fakes.arts[0]
    const video = art.video
    button('缩小到小窗')!.click()
    await settle()
    expect(await hiddenSoon()).toBe(true)
    expect(miniSlot()?.contains(video)).toBe(true)
    expect(video.isConnected).toBe(true)
    expect(art.destroyed).toBe(0)

    // 缩小后 Esc 不再关弹窗（焦点不在小窗里时也不关小窗）
    esc()
    await settle()
    expect(dock.miniSession().value).not.toBeNull()

    button('展开')!.click()
    await settle()
    expect(modalVisible()).toBe(true)
    expect(modal()?.contains(video)).toBe(true)
    expect(miniSlot()?.contains(video)).toBe(false)
    expect(dock.miniSession().value).toBeNull()
    expect(fakes.arts).toHaveLength(1)
    expect(fakes.hlsList).toHaveLength(1)
    expect(fakes.hlsList[0].loads).toEqual([SRC])
    expect(fakes.hlsList[0].destroyed).toBe(0)
    t.unmount()
  })

  it('小窗里关闭：拆除并清空弹窗，进度保存；之后还能再打开', async () => {
    const t = await mountApp()
    await openOne()
    const art = fakes.arts[0]
    tick(art, 42)
    button('缩小到小窗')!.click()
    await settle()
    tick(art, 61)
    button('关闭小窗')!.click()
    await settle()
    expect(art.destroyed).toBe(1)
    expect(dock.miniSession().value).toBeNull()
    expect(await hiddenSoon()).toBe(true)
    expect(player.getMediaProgress(SRC)).toBe(61)

    await openOne({ url: OTHER, title: '另一部' })
    expect(modalVisible()).toBe(true)
    expect(modal()?.contains(fakes.arts[1].video)).toBe(true)
    t.unmount()
  })

  it('小窗的播放 / 暂停按钮控制同一个 <video>', async () => {
    const t = await mountApp()
    await openOne()
    const video = fakes.arts[0].video
    setPlaying(video)
    const pause = vi.fn()
    video.pause = pause
    button('缩小到小窗')!.click()
    await settle()
    button('暂停')!.click()
    expect(pause).toHaveBeenCalledTimes(1)
    t.unmount()
  })

  it('切路由：弹窗自动缩成小窗；小窗跨路由保持，不自己展开', async () => {
    const t = await mountApp()
    await openOne()
    const video = fakes.arts[0].video
    await t.router.push('/b')
    await settle()
    expect(await hiddenSoon()).toBe(true)
    expect(miniSlot()?.contains(video)).toBe(true)
    await t.router.push('/a')
    await settle()
    expect(await hiddenSoon()).toBe(true)
    expect(miniSlot()?.contains(video)).toBe(true)
    expect(fakes.arts).toHaveLength(1)
    t.unmount()
  })

  it('设置关闭小窗：没有缩小按钮，切路由时弹窗保持', async () => {
    await settings.setSetting('ui.miniPlayer', false)
    const t = await mountApp()
    await openOne()
    expect(button('缩小到小窗')).toBeNull()
    await t.router.push('/b')
    await settle()
    expect(modalVisible()).toBe(true)
    expect(dock.miniSession().value).toBeNull()
    expect(fakes.arts[0].destroyed).toBe(0)
    t.unmount()
  })

  it('缩小时又播放别的：旧会话拆除，新的在弹窗里展开', async () => {
    const t = await mountApp()
    await openOne()
    button('缩小到小窗')!.click()
    await settle()
    await openOne({ url: OTHER, title: '另一部' })
    expect(fakes.arts[0].destroyed).toBe(1)
    expect(dock.miniSession().value).toBeNull()
    expect(modalVisible()).toBe(true)
    expect(fakes.arts).toHaveLength(2)
    expect(modal()?.contains(fakes.arts[1].video)).toBe(true)
    expect(fakes.hlsList.at(-1)?.loads).toEqual([OTHER])
    t.unmount()
  })

  it('小窗里连播到下一集：留在小窗，播放 / 暂停改控制新的 <video>', async () => {
    const t = await mountApp()
    await openOne({
      url: SRC,
      title: '剧',
      playlist: [
        { url: SRC, name: '第 1 集' },
        { url: OTHER, name: '第 2 集' },
      ],
      index: 0,
    })
    button('缩小到小窗')!.click()
    await settle()
    fakes.arts[0].emit('video:ended', new Event('ended'))
    await settle()
    expect(fakes.arts).toHaveLength(2)
    const next = fakes.arts[1].video
    expect(miniSlot()?.contains(next)).toBe(true)
    expect(await hiddenSoon()).toBe(true)
    setPlaying(next)
    next.dispatchEvent(new Event('play'))
    const pause = vi.fn()
    next.pause = pause
    await settle()
    button('暂停')!.click()
    expect(pause).toHaveBeenCalledTimes(1)
    t.unmount()
  })

  it('桌面端弹窗里的 HLS 走专用加载器（分片经主进程校验）；网页端用 hls.js 默认加载', async () => {
    const { DesktopHlsLoader } =
      await import('../src/renderer/src/features/player/utils/hls-loader')
    const t = await mountApp()
    await openOne()
    expect(fakes.hlsList[0].config.loader).toBeUndefined()
    ;(window as unknown as { api: unknown }).api = {}
    try {
      await openOne({ url: OTHER, title: '另一部' })
      expect(fakes.hlsList.at(-1)?.loads).toEqual([OTHER])
      expect(fakes.hlsList.at(-1)?.config.loader).toBe(DesktopHlsLoader)
    } finally {
      delete (window as unknown as { api?: unknown }).api
    }
    t.unmount()
  })

  it('引擎为 mpv 且 mpv 可用：照旧交给 mpv，不打开弹窗', async () => {
    const t = await mountApp()
    await settings.setSetting('player.engine', 'mpv')
    const open = vi.fn(async () => ({ success: true }))
    ;(window as unknown as { api: unknown }).api = {
      mpv: { open, setVsr: async () => {} },
    }
    try {
      expect(await player.openMediaPlayer({ url: SRC, title: '片名' })).toBe(
        true
      )
      await settle()
      expect(open).toHaveBeenCalledTimes(1)
      expect(await hiddenSoon()).toBe(true)
      expect(fakes.arts).toHaveLength(0)
    } finally {
      delete (window as unknown as { api?: unknown }).api
    }
    t.unmount()
  })
})

describe('小窗与 Esc 层栈', () => {
  it('焦点在小窗里按 Esc 关闭小窗；焦点在别处时 Esc 不关', async () => {
    const t = await mountApp()
    await openOne()
    const art = fakes.arts[0]
    setPlaying(art.video)
    button('缩小到小窗')!.click()
    await settle()
    esc()
    await settle()
    expect(dock.miniSession().value).not.toBeNull()
    button('暂停')!.focus()
    await settle()
    esc()
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(art.destroyed).toBe(1)
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
