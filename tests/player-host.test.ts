// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 测试里就地拼宿主页面 */
import {
  type Component,
  createApp,
  defineComponent,
  h,
  isProxy,
  nextTick,
  reactive,
} from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { streamProxyPath } from '../src/shared/engine-http'
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

/**
 * 内置播放器放在哪儿播（features/player/host）：
 * - 网页端：openMediaPlayer 打开盖在页面上的播放层，Esc / 关闭按钮关掉并保存进度、拆除 Artplayer 与 hls；
 * - 桌面端主窗口：载荷（普通 JSON、带片库续播位置）交给独立播放器窗口，本窗口不建播放器；
 *   播放器窗口转回来的进度事件就地写进进度表 / 继续播放，在播状态驱动遥控；
 * - 桌面端播放器窗口（PlayerWindowApp）：取走载荷开播、换片，进度事件与在播状态交给主窗口，执行遥控并回执。
 *
 * Artplayer / hls.js 换成记数的替身：判据是「构造次数、loadSource 次数，<video> 是同一个元素」。
 */

const fakes = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void
  const arts: FakeArt[] = []
  const hlsList: FakeHls[] = []
  /**
   * layers / controls / setting / contextmenu 的最小桩：add 返回一个元素并记下该项；
   * setting 菜单还要 update / find（睡眠定时会改菜单项文字）。
   */
  class FakeComponent {
    show = false
    items: { name?: string; html?: string }[] = []
    constructor(private readonly host?: () => HTMLElement) {}
    get names(): string[] {
      return this.items.map(it => it.name ?? '')
    }
    add(item: { name?: string; html?: string }): HTMLElement {
      this.items.push(item)
      const el = document.createElement('div')
      el.innerHTML = item.html ?? ''
      this.host?.().appendChild(el)
      return el
    }
    update(item: { name?: string }): void {
      const i = this.items.findIndex(it => it.name === item.name)
      if (i >= 0) this.items[i] = item
      else this.items.push(item)
    }
    find(name: string): { $tooltip?: HTMLElement } | undefined {
      return this.items.some(it => it.name === name) ? {} : undefined
    }
    remove(name: string): void {
      this.items = this.items.filter(it => it.name !== name)
    }
  }
  class FakeArt {
    option: Record<string, unknown>
    video: HTMLVideoElement
    template: { $player: HTMLElement; $container: HTMLElement }
    destroyed = 0
    notice = { show: '' }
    subtitle = { switch: async (): Promise<void> => {} }
    /** 浮层挂到播放器根节点（播放信息会在里面查元素） */
    layers = new FakeComponent(() => this.template.$player)
    controls = new FakeComponent()
    setting = new FakeComponent()
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

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

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
  settings = await import('../src/renderer/src/features/settings')
  player = await import('../src/renderer/src/features/player')
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (window as unknown as { api?: unknown }).api
})

// ── 接入：真 PlayerModal + PlayerSession + UnifiedVideoPlayer + 路由 ──────────

interface Harness {
  router: ReturnType<typeof createRouter>
  root: HTMLElement
  unmount: () => void
}

async function mountApp(): Promise<Harness> {
  const { PlayerModal } = player
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
    setup: () => () => [h(RouterView), h(PlayerModal as Component)],
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
/** 播放层是否显示 */
const modalVisible = (): boolean => modal() !== null

/** 隐藏有淡出过渡（jsdom 里没有样式，过渡在两帧后结束）：等它收起 */
async function hiddenSoon(): Promise<boolean> {
  await until(() => !modalVisible())
  return !modalVisible()
}

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

describe('网页端播放层', () => {
  it('网页端（没有播放器窗口）：openMediaPlayer 打开盖在页面上的播放层，Artplayer 只建一次', async () => {
    const t = await mountApp()
    expect(await hiddenSoon()).toBe(true)
    expect(await openOne()).toBe(true)
    expect(modalVisible()).toBe(true)
    expect(fakes.arts).toHaveLength(1)
    expect(modal()?.contains(fakes.arts[0].video)).toBe(true)
    // 网页端的跨源地址经片库服务的播放代理（ADR-0019），进度仍记原地址
    expect(fakes.hlsList[0].loads).toEqual([streamProxyPath(SRC)])
    // 截图插件装上了：保存提示层、右键「截图」「截 GIF」
    expect(fakes.arts[0].layers.names).toContain('ybCaptureSaved')
    expect(fakes.arts[0].contextmenu.names).toEqual(
      expect.arrayContaining(['ybScreenshot', 'ybScreenshotGif'])
    )
    // 播放器核心还装上了播放信息的浮层、设置项与右键菜单项
    const art = fakes.arts[0]
    for (const part of [art.layers, art.setting, art.contextmenu])
      expect(part.items.map(it => it.name)).toContain('ybPlaybackInfo')
    // 以及睡眠定时菜单项
    expect(art.setting.items.map(it => it.name)).toContain('ybSleep')
    // 页面还在（播放层只是盖在上面）
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

  it('有桌面端的桥时 HLS 走专用加载器（分片经主进程校验）；网页端用 hls.js 默认加载', async () => {
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

  it('引擎为 mpv 且 mpv 可用：照旧交给 mpv，不打开播放层', async () => {
    const t = await mountApp()
    await settings.setSetting('player.engine', 'mpv')
    const open = vi.fn(async () => ({ success: true }))
    const onStatus = vi.fn(() => () => {})
    ;(window as unknown as { api: unknown }).api = {
      mpv: { open, setVsr: async () => {}, onStatus },
    }
    try {
      expect(await player.openMediaPlayer({ url: SRC, title: '片名' })).toBe(
        true
      )
      await settle()
      expect(open).toHaveBeenCalledTimes(1)
      // 交给 mpv 后跟着它推来的状态记进度、连播下一集
      expect(onStatus).toHaveBeenCalledTimes(1)
      expect(await hiddenSoon()).toBe(true)
      expect(fakes.arts).toHaveLength(0)
    } finally {
      delete (window as unknown as { api?: unknown }).api
    }
    t.unmount()
  })
})

/** 假的播放器窗口桥（window.api.playerWindow）：记下调用，事件回调存进 handlers 由测试触发 */
type WindowEventHandler = (payload: never) => void

/** 假桥：方法都是 vi.fn，handlers 按事件名存回调 */
interface FakeWindowApi {
  handlers: Record<string, WindowEventHandler>
  open: Mock
  close: Mock
  command: Mock
  ready: Mock
  progress: Mock
  state: Mock
  navigate: Mock
  reply: Mock
  onPlay: Mock
  offPlay: Mock
  onRemote: Mock
  offRemote: Mock
  onRelay: Mock
  offRelay: Mock
  onSession: Mock
  offSession: Mock
  onRoute: Mock
  offRoute: Mock
}

function fakeWindowApi(first: unknown = null): FakeWindowApi {
  const handlers: Record<string, WindowEventHandler> = {}
  const on = (name: string): Mock =>
    vi.fn((cb: (payload: never) => void) => {
      handlers[name] = cb
    })
  return {
    handlers,
    open: vi.fn(async (_payload: unknown) => {}),
    close: vi.fn(async () => {}),
    command: vi.fn(async (_request: unknown) => ({
      ok: true,
      text: '已切到 2 倍速',
    })),
    ready: vi.fn(async () => first),
    progress: vi.fn(async (_event: unknown) => {}),
    state: vi.fn(async (_state: unknown) => {}),
    navigate: vi.fn(async (_to: string) => {}),
    reply: vi.fn(async (_id: number, _reply: unknown) => {}),
    onPlay: on('play'),
    offPlay: vi.fn(),
    onRemote: on('remote'),
    offRemote: vi.fn(),
    onRelay: on('relay'),
    offRelay: vi.fn(),
    onSession: on('session'),
    offSession: vi.fn(),
    onRoute: on('route'),
    offRoute: vi.fn(),
  }
}

function useWindowApi(api: FakeWindowApi): void {
  ;(window as unknown as { api: unknown }).api = { playerWindow: api }
}

/** 控制栏「置顶」按钮（Artplayer 控件，替身里只记下配置；点击即调用它的 click） */
const pinControl = (): { click: () => void } | undefined =>
  fakes.arts.at(-1)?.controls.items.find(item => item.name === 'ybPin') as
    | { click: () => void }
    | undefined

describe('桌面端主窗口：播放交给独立播放器窗口', () => {
  it('openMediaPlayer 把普通 JSON 载荷交给播放器窗口，本窗口不建播放器；媒体库条目带上片库记的续播位置', async () => {
    const api = fakeWindowApi()
    useWindowApi(api)
    player.setLibraryProgressSink({
      resumeAt: ref => (ref.fileId === 2 ? 42 : undefined),
      report: vi.fn(),
      flush: vi.fn(),
    })
    const t = await mountApp()
    const playlist = reactive([
      { filePath: '/m/1.mkv', library: { itemId: 1, fileId: 1 } },
      { filePath: '/m/2.mkv', library: { itemId: 2, fileId: 2 } },
    ])
    expect(
      await player.openMediaPlayer({ playlist, index: 0, title: '剧' })
    ).toBe(true)
    await settle()
    expect(api.open).toHaveBeenCalledTimes(1)
    const sent = api.open.mock.calls[0][0] as {
      playlist: Array<{ libraryResume?: number }>
      title: string
    }
    // 经 IPC 结构化克隆：不能带 Vue 代理
    expect(isProxy(sent.playlist)).toBe(false)
    expect(sent.title).toBe('剧')
    expect(sent.playlist[0].libraryResume).toBeUndefined()
    expect(sent.playlist[1].libraryResume).toBe(42)
    expect(fakes.arts).toHaveLength(0)
    expect(modal()).toBeNull()
    t.unmount()
  })

  it('播放器窗口转回来的进度事件就地写：本地进度表、看完、片库上报', async () => {
    const api = fakeWindowApi()
    useWindowApi(api)
    const report = vi.fn()
    const flush = vi.fn()
    player.setLibraryProgressSink({ resumeAt: () => undefined, report, flush })
    const navigate = vi.fn()
    player.installPlayerHost(navigate)
    const relay = (event: unknown): void => api.handlers.relay(event as never)
    relay({ kind: 'save', target: { key: 'k1' }, position: 50, duration: 100 })
    expect(player.getMediaProgress('k1')).toBe(50)
    relay({ kind: 'finish', target: { key: 'k1' }, duration: 100 })
    expect(player.getMediaProgress('k1')).toBe(0)
    expect(player.isWatched('k1')).toBe(true)
    const library = { itemId: 3, fileId: 4 }
    relay({
      kind: 'save',
      target: { key: '/m/x.mkv', library },
      position: 7,
      duration: 60,
    })
    expect(report).toHaveBeenCalledWith(library, 7, 60, false)
    expect(player.getMediaProgress('/m/x.mkv')).toBe(0)
    relay({ kind: 'flush' })
    expect(flush).toHaveBeenCalled()
    api.handlers.route('/tv' as never)
    expect(navigate).toHaveBeenCalledWith('/tv')
  })

  it('在播状态来自播放器窗口：私密、遥控经主进程转发并等回执，关窗后清空', async () => {
    const api = fakeWindowApi()
    useWindowApi(api)
    player.installPlayerHost(() => {})
    expect(player.playerSession().value).toBeNull()
    expect(await player.runPlayerCommand({ kind: 'rate', value: 2 })).toEqual({
      ok: false,
      text: '现在没有正在播放的视频',
    })
    api.handlers.session({
      title: '第 3 集',
      private: true,
      controllable: true,
      plotQa: true,
      seconds: 61,
    } as never)
    expect(player.playerSession().value).toEqual({
      private: true,
      inPage: false,
    })
    expect(player.playerRemoteState()).toEqual({
      playing: true,
      controllable: true,
      private: true,
      plotQa: true,
    })
    expect(player.playerNowPlaying()).toEqual({
      title: '第 3 集',
      seconds: 61,
      private: true,
    })
    expect(await player.runPlayerCommand({ kind: 'rate', value: 2 })).toEqual({
      ok: true,
      text: '已切到 2 倍速',
    })
    expect(api.command).toHaveBeenLastCalledWith({
      kind: 'remote',
      command: { kind: 'rate', value: 2 },
    })
    expect(await player.askPlotQuestion('他是谁')).toBe(true)
    expect(api.command).toHaveBeenLastCalledWith({
      kind: 'ask',
      question: '他是谁',
    })
    player.closePlayer()
    expect(api.close).toHaveBeenCalled()
    api.handlers.session(null as never)
    expect(player.playerSession().value).toBeNull()
    expect(player.playerRemoteState().playing).toBe(false)
  })
})

describe('桌面端播放器窗口（PlayerWindowApp）', () => {
  async function mountWindow(api: FakeWindowApi): Promise<() => void> {
    useWindowApi(api)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(player.PlayerWindowApp as Component)
    app.mount(root)
    await settle()
    return () => app.unmount()
  }

  it('取走等着的载荷开播；进度事件交给主窗口、本窗口不写；在播状态报上去', async () => {
    const api = fakeWindowApi({ url: SRC, title: '片名', continueId: 'c1' })
    const unmount = await mountWindow(api)
    await until(() => fakes.arts.length === 1)
    expect(api.ready).toHaveBeenCalledTimes(1)
    expect(fakes.hlsList[0].loads).toEqual([SRC])
    // 窗口里没有网页端的关闭圆钮，窗口键胶囊不在（没有 win 桥）
    expect(button('关闭播放器')).toBeNull()
    tick(fakes.arts[0], 30)
    expect(api.progress).toHaveBeenCalledWith({
      kind: 'save',
      target: { key: SRC, library: undefined },
      position: 30,
      duration: 600,
    })
    expect(api.progress).toHaveBeenCalledWith({
      kind: 'continue',
      id: 'c1',
      update: expect.objectContaining({ index: 0, progress: 30 }),
    })
    // 写入在主窗口：播放器窗口自己不落地
    expect(player.getMediaProgress(SRC)).toBe(0)
    await until(() =>
      api.state.mock.calls.some(
        ([s]) => (s as { controllable?: boolean }).controllable === true
      )
    )
    expect(api.state).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: '片名',
        private: false,
        controllable: true,
      })
    )
    unmount()
  })

  it('换片：旧会话保存进度后拆除，新会话开播；遥控请求就地执行并回执；置顶按钮切换设置', async () => {
    const api = fakeWindowApi({ url: SRC, title: '片名' })
    const unmount = await mountWindow(api)
    await until(() => fakes.arts.length === 1)
    const first = fakes.arts[0]
    tick(first, 95)
    api.progress.mockClear()
    api.handlers.play({ url: OTHER, title: '另一部' } as never)
    await until(() => fakes.arts.length === 2)
    expect(first.destroyed).toBe(1)
    expect(api.progress).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'save', position: 95 })
    )
    expect(fakes.hlsList.at(-1)?.loads).toEqual([OTHER])

    api.handlers.remote({
      id: 7,
      request: { kind: 'remote', command: { kind: 'rate', value: 2 } },
    } as never)
    expect(api.reply).toHaveBeenCalledWith(7, {
      ok: true,
      text: '已切到 2 倍速',
    })
    api.handlers.remote({
      id: 8,
      request: { kind: 'ask', question: '他是谁' },
    } as never)
    expect(api.reply).toHaveBeenLastCalledWith(8, { ok: false, text: '' })

    expect(settings.getSetting('player.windowOnTop')).toBe(false)
    pinControl()!.click()
    await settle()
    expect(settings.getSetting('player.windowOnTop')).toBe(true)
    expect(fakes.arts.at(-1)?.notice.show).toBe('已置顶')
    unmount()
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
