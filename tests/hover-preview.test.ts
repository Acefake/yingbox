import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bindCardPreview,
  bindGridPreview,
} from '../src/renderer/src/components/ui/hover-preview/bind'
import {
  type PreviewController,
  type PreviewStage,
  createPreviewController,
} from '../src/renderer/src/components/ui/hover-preview/controller'
import { createDomStage } from '../src/renderer/src/components/ui/hover-preview/stage'
import type {
  PreviewMedia,
  PreviewSettings,
  PreviewSource,
} from '../src/renderer/src/components/ui/hover-preview/types'

/**
 * 悬停预览：控制器（延时、全局只播一张、离开 / 停止即释放、减少动效、关闭）
 * 与 DOM 舞台（静音循环、从片中 10% 起播几秒、出错退回图片、释放时清 src + load()）。
 * 测试里没有 DOM：舞台用最小的假元素，控制器用假舞台。
 */

/** 最小的假元素：记录属性、子节点、调用。 */
class FakeEl {
  tag: string
  attrs = new Map<string, string>()
  children: FakeEl[] = []
  parent: FakeEl | null = null
  classes = new Set<string>()
  calls: string[] = []
  // <video> / <img> 的属性
  src = ''
  muted = false
  loop = false
  playsInline = false
  preload = ''
  duration = Number.NaN
  currentTime = 0
  onloadedmetadata: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  onplaying: (() => void) | null = null
  onerror: (() => void) | null = null
  onload: (() => void) | null = null
  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
  }
  constructor(tag: string) {
    this.tag = tag
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
    if (name === 'src') this.src = value
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
    if (name === 'src') this.src = ''
    this.calls.push(`removeAttribute:${name}`)
  }
  append(child: FakeEl): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = this
    this.children.push(child)
  }
  remove(): void {
    if (!this.parent) return
    this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  play(): Promise<void> {
    this.calls.push('play')
    return Promise.resolve()
  }
  pause(): void {
    this.calls.push('pause')
  }
  load(): void {
    this.calls.push(`load:${this.src}`)
  }
}

const fakeDoc = (): {
  createElement: (tag: string) => FakeEl
  created: FakeEl[]
} => {
  const created: FakeEl[] = []
  return {
    created,
    createElement: tag => {
      const el = new FakeEl(tag)
      created.push(el)
      return el
    },
  }
}

const host = (): FakeEl => new FakeEl('div')
const asHost = (el: FakeEl): HTMLElement => el as unknown as HTMLElement

const video = (url = 'https://v/a.mp4'): PreviewMedia => ({
  kind: 'video',
  url,
})

/** 假舞台：记录 show / clear。 */
function fakeStage(): PreviewStage & {
  log: string[]
} {
  const log: string[] = []
  return {
    log,
    show: (h, media) =>
      log.push(
        `show:${(h as unknown as FakeEl).tag}:${media.kind === 'video' ? media.url : media.urls.join(',')}`
      ),
    clear: () => log.push('clear'),
  }
}

const source = (
  key: string,
  media: PreviewMedia | null = video(`https://v/${key}.mp4`)
): PreviewSource & { calls: number; signals: AbortSignal[] } => {
  const self = {
    key,
    calls: 0,
    signals: [] as AbortSignal[],
    resolve: async (signal: AbortSignal) => {
      self.calls++
      self.signals.push(signal)
      return media
    },
  }
  return self
}

describe('悬停预览控制器', () => {
  let settings: PreviewSettings
  let reduced: boolean
  let stage: ReturnType<typeof fakeStage>
  const make = (): ReturnType<typeof createPreviewController> =>
    createPreviewController({
      stage,
      settings: () => settings,
      reducedMotion: () => reduced,
    })

  beforeEach(() => {
    vi.useFakeTimers()
    settings = { enabled: true, delayMs: 600 }
    reduced = false
    stage = fakeStage()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('悬停满设置的延时才取预览源并播放；不到延时离开不取源', async () => {
    const c = make()
    const a = source('a')
    c.enter(a, asHost(host()))
    await vi.advanceTimersByTimeAsync(599)
    expect(a.calls).toBe(0)
    expect(stage.log).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(a.calls).toBe(1)
    expect(stage.log).toEqual(['show:div:https://v/a.mp4'])
    expect(c.activeKey()).toBe('a')

    const b = source('b')
    c.enter(b, asHost(host()))
    await vi.advanceTimersByTimeAsync(300)
    c.leave('b')
    await vi.advanceTimersByTimeAsync(1000)
    expect(b.calls).toBe(0)
  })

  it('延时跟随设置（读的是当时的值）', async () => {
    settings = { enabled: true, delayMs: 200 }
    const c = make()
    const a = source('a')
    c.enter(a, asHost(host()))
    await vi.advanceTimersByTimeAsync(200)
    expect(a.calls).toBe(1)
  })

  it('同一时刻全局只播一张：进入下一张先停掉上一张', async () => {
    const c = make()
    c.enter(source('a'), asHost(host()))
    await vi.advanceTimersByTimeAsync(600)
    c.enter(source('b'), asHost(host()))
    expect(stage.log).toEqual(['show:div:https://v/a.mp4', 'clear'])
    await vi.advanceTimersByTimeAsync(600)
    expect(stage.log.at(-1)).toBe('show:div:https://v/b.mp4')
    expect(c.activeKey()).toBe('b')
  })

  it('在同一张卡里移动（重复 enter 同一个 key 与容器）不重新计时', async () => {
    const c = make()
    const a = source('a')
    const h = asHost(host())
    c.enter(a, h)
    await vi.advanceTimersByTimeAsync(400)
    c.enter(a, h)
    await vi.advanceTimersByTimeAsync(200)
    expect(a.calls).toBe(1)
  })

  it('离开 / 停止：释放舞台；离开别的 key 不影响正在播的', async () => {
    const c = make()
    c.enter(source('a'), asHost(host()))
    await vi.advanceTimersByTimeAsync(600)
    c.leave('other')
    expect(stage.log).not.toContain('clear')
    c.leave('a')
    expect(stage.log.at(-1)).toBe('clear')
    expect(c.activeKey()).toBeNull()

    c.enter(source('b'), asHost(host()))
    await vi.advanceTimersByTimeAsync(600)
    c.stop()
    expect(stage.log.at(-1)).toBe('clear')
    expect(c.activeKey()).toBeNull()
  })

  it('取源过程中离开：取消请求（signal 中止），结果回来也不播', async () => {
    let finish: (m: PreviewMedia) => void = () => {}
    const slow: PreviewSource & { signal?: AbortSignal } = {
      key: 'slow',
      resolve: signal => {
        slow.signal = signal
        return new Promise(resolve => (finish = resolve))
      },
    }
    const c = make()
    c.enter(slow, asHost(host()))
    await vi.advanceTimersByTimeAsync(600)
    c.leave('slow')
    expect(slow.signal?.aborted).toBe(true)
    finish(video())
    await vi.advanceTimersByTimeAsync(0)
    expect(stage.log.filter(l => l.startsWith('show'))).toEqual([])
  })

  it('没有预览（null）或取源失败：保持静态封面，不调用舞台', async () => {
    const c = make()
    c.enter(source('none', null), asHost(host()))
    await vi.advanceTimersByTimeAsync(600)
    const failing: PreviewSource = {
      key: 'bad',
      resolve: () => Promise.reject(new Error('net')),
    }
    c.enter(failing, asHost(host()))
    await vi.advanceTimersByTimeAsync(600)
    expect(stage.log.filter(l => l.startsWith('show'))).toEqual([])
  })

  it('设置里关闭、或系统开启「减少动态效果」时不自动播', async () => {
    settings = { enabled: false, delayMs: 600 }
    const c = make()
    const a = source('a')
    c.enter(a, asHost(host()))
    await vi.advanceTimersByTimeAsync(2000)
    expect(a.calls).toBe(0)

    settings = { enabled: true, delayMs: 600 }
    reduced = true
    c.enter(a, asHost(host()))
    await vi.advanceTimersByTimeAsync(2000)
    expect(a.calls).toBe(0)
    expect(stage.log).toEqual([])
  })
})

describe('悬停预览舞台（DOM）', () => {
  it('视频：静音、内联、循环，放进容器后播放；开始播放才淡入', () => {
    const doc = fakeDoc()
    const stage = createDomStage(doc as unknown as Document)
    const h = host()
    stage.show(asHost(h), video('https://v/t.mp4'))
    const v = h.children[0]
    expect(v.tag).toBe('video')
    expect(v.src).toBe('https://v/t.mp4')
    expect(v.muted).toBe(true)
    expect(v.playsInline).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.calls).toContain('play')
    expect(v.classes.has('is-visible')).toBe(false)
    v.onplaying?.()
    expect(v.classes.has('is-visible')).toBe(true)
  })

  it('本地片段：从片长 10% 处起播，只循环 clipSeconds 秒', () => {
    const doc = fakeDoc()
    const stage = createDomStage(doc as unknown as Document)
    const h = host()
    stage.show(asHost(h), {
      kind: 'video',
      url: 'local:///m.mp4',
      startRatio: 0.1,
      clipSeconds: 6,
    })
    const v = h.children[0]
    expect(v.loop).toBe(false)
    v.duration = 7200
    v.onloadedmetadata?.()
    expect(v.currentTime).toBe(720)
    v.currentTime = 726.5
    v.ontimeupdate?.()
    expect(v.currentTime).toBe(720)
    v.currentTime = 723
    v.ontimeupdate?.()
    expect(v.currentTime).toBe(723)
  })

  it('释放：暂停、清空 src 并 load()，元素移出容器', () => {
    const doc = fakeDoc()
    const stage = createDomStage(doc as unknown as Document)
    const h = host()
    stage.show(asHost(h), video())
    const v = h.children[0]
    stage.clear()
    expect(h.children).toEqual([])
    expect(v.src).toBe('')
    expect(v.calls).toContain('pause')
    expect(v.calls).toContain('removeAttribute:src')
    expect(v.calls.at(-1)).toBe('load:')
    expect(v.onplaying).toBeNull()
  })

  it('全局复用一个 <video>：换到另一张卡时从旧容器移走', () => {
    const doc = fakeDoc()
    const stage = createDomStage(doc as unknown as Document)
    const h1 = host()
    const h2 = host()
    stage.show(asHost(h1), video('https://v/1.mp4'))
    stage.show(asHost(h2), video('https://v/2.mp4'))
    expect(h1.children).toEqual([])
    expect(h2.children[0].src).toBe('https://v/2.mp4')
    expect(doc.created.filter(el => el.tag === 'video')).toHaveLength(1)
  })

  it('视频播不了（编码不支持 / 404）：有备用图片就轮播图片，没有就收起', () => {
    vi.useFakeTimers()
    try {
      const doc = fakeDoc()
      const stage = createDomStage(doc as unknown as Document)
      const h = host()
      stage.show(asHost(h), {
        kind: 'video',
        url: 'local:///x.mkv',
        fallback: ['https://i/1.jpg', 'https://i/2.jpg'],
      })
      const v = h.children[0]
      v.onerror?.()
      expect(v.src).toBe('')
      expect(h.children.map(c => c.tag)).toEqual(['img'])
      expect(h.children[0].src).toBe('https://i/1.jpg')

      const h2 = host()
      stage.show(asHost(h2), video())
      h2.children[0].onerror?.()
      expect(h2.children).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('图片序列：按间隔轮播、加载后淡入；释放时停表并清 src', () => {
    vi.useFakeTimers()
    try {
      const doc = fakeDoc()
      const stage = createDomStage(doc as unknown as Document)
      const h = host()
      stage.show(asHost(h), {
        kind: 'images',
        urls: ['a.jpg', 'b.jpg', 'c.jpg'],
        intervalMs: 1000,
      })
      const img = h.children[0]
      expect(img.tag).toBe('img')
      expect(img.src).toBe('a.jpg')
      img.onload?.()
      expect(img.classes.has('is-visible')).toBe(true)
      vi.advanceTimersByTime(1000)
      expect(img.src).toBe('b.jpg')
      vi.advanceTimersByTime(2000)
      expect(img.src).toBe('a.jpg')
      stage.clear()
      expect(h.children).toEqual([])
      expect(img.src).toBe('')
      vi.advanceTimersByTime(5000)
      expect(img.src).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

/** 事件绑定用的假元素：监听、包含关系、closest / matches / querySelector。 */
class EvEl {
  listeners = new Map<string, Array<(e: unknown) => void>>()
  kids: EvEl[] = []
  parent: EvEl | null = null
  focusVisible = true
  constructor(readonly cls: string) {}
  add(child: EvEl): EvEl {
    child.parent = this
    this.kids.push(child)
    return child
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(f => f !== fn)
    )
  }
  fire(type: string, e: Record<string, unknown> = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ ...e })
  }
  contains(other: unknown): boolean {
    for (let n = other as EvEl | null; n; n = n.parent)
      if (n === this) return true
    return false
  }
  closest(selector: string): EvEl | null {
    if (`.${this.cls}` === selector) return this
    return this.parent?.closest(selector) ?? null
  }
  matches(selector: string): boolean {
    return selector === ':focus-visible' ? this.focusVisible : false
  }
  querySelector(selector: string): EvEl | null {
    for (const kid of this.kids) {
      if (`.${kid.cls}` === selector) return kid
      const deep = kid.querySelector(selector)
      if (deep) return deep
    }
    return null
  }
}

/** 假 IntersectionObserver：记下回调，测试里手动触发。 */
function fakeObserver(): {
  Ctor: typeof IntersectionObserver
  hide: () => void
  live: () => number
} {
  const all: Array<{ cb: (e: unknown[]) => void; on: boolean }> = []
  class Fake {
    entry: { cb: (e: unknown[]) => void; on: boolean }
    constructor(cb: (e: unknown[]) => void) {
      this.entry = { cb, on: false }
      all.push(this.entry)
    }
    observe(): void {
      this.entry.on = true
    }
    disconnect(): void {
      this.entry.on = false
    }
  }
  return {
    Ctor: Fake as unknown as typeof IntersectionObserver,
    hide: () =>
      all.filter(o => o.on).forEach(o => o.cb([{ isIntersecting: false }])),
    live: () => all.filter(o => o.on).length,
  }
}

function recorder(): PreviewController & { log: string[] } {
  const log: string[] = []
  let active: string | null = null
  return {
    log,
    enter: (s, h) => {
      active = s.key
      log.push(`enter:${s.key}:${(h as unknown as EvEl).cls}`)
    },
    leave: key => {
      if (active === key) active = null
      log.push(`leave:${key}`)
    },
    stop: () => {
      active = null
      log.push('stop')
    },
    activeKey: () => active,
  }
}

describe('卡片绑定', () => {
  it('鼠标进入触发、离开停止；触屏不触发；键盘聚焦触发、鼠标点击聚焦不触发；滚出视口停止', () => {
    const card = new EvEl('card')
    const hostEl = card.add(new EvEl('preview'))
    const c = recorder()
    const io = fakeObserver()
    let s: PreviewSource | null = source('a')
    const unbind = bindCardPreview(
      card as unknown as HTMLElement,
      () => hostEl as unknown as HTMLElement,
      () => s,
      c,
      io.Ctor
    )
    card.fire('pointerenter', { pointerType: 'touch' })
    expect(c.log).toEqual([])
    card.fire('pointerenter', { pointerType: 'mouse' })
    expect(c.log).toEqual(['enter:a:preview'])
    card.fire('pointerleave')
    expect(c.log.at(-1)).toBe('leave:a')

    card.focusVisible = false
    card.fire('focusin')
    expect(c.log).toHaveLength(2)
    card.focusVisible = true
    card.fire('focusin')
    expect(c.log.at(-1)).toBe('enter:a:preview')
    card.fire('focusout', { relatedTarget: hostEl })
    expect(c.log.at(-1)).toBe('enter:a:preview')
    io.hide()
    expect(c.log.at(-1)).toBe('leave:a')

    s = null
    card.fire('pointerenter', { pointerType: 'mouse' })
    expect(c.log.at(-1)).toBe('leave:a')
    s = source('a')
    unbind()
    expect(card.listeners.get('pointerenter')).toEqual([])
    expect(io.live()).toBe(0)
  })
})

describe('网格委托绑定', () => {
  const grid = (): { root: EvEl; cells: EvEl[] } => {
    const root = new EvEl('grid')
    const cells = [1, 2].map(i => {
      const cell = root.add(new EvEl('cell'))
      const media = cell.add(new EvEl('media'))
      media.add(new EvEl('preview'))
      ;(cell as unknown as { id: number }).id = i
      return cell
    })
    return { root, cells }
  }
  const opts = {
    cell: '.cell',
    host: '.preview',
    source: (cell: HTMLElement) =>
      source(`item-${(cell as unknown as { id: number }).id}`),
  }

  it('指针在格子间移动：换格子才重新进入；移到格子外 / 离开网格停止', () => {
    const { root, cells } = grid()
    const c = recorder()
    const io = fakeObserver()
    const bound = bindGridPreview(
      root as unknown as HTMLElement,
      opts,
      c,
      io.Ctor
    )
    root.fire('pointerover', { pointerType: 'mouse', target: cells[0].kids[0] })
    root.fire('pointerover', { pointerType: 'mouse', target: cells[0] })
    expect(c.log).toEqual(['enter:item-1:preview'])
    expect(bound.activeCell()).toBe(cells[0])
    root.fire('pointerover', { pointerType: 'mouse', target: cells[1] })
    expect(c.log).toEqual([
      'enter:item-1:preview',
      'leave:item-1',
      'enter:item-2:preview',
    ])
    root.fire('pointerover', { pointerType: 'mouse', target: root })
    expect(c.log.at(-1)).toBe('leave:item-2')
    root.fire('pointerover', { pointerType: 'mouse', target: cells[0] })
    root.fire('pointerleave')
    expect(c.log.at(-1)).toBe('leave:item-1')
    expect(bound.activeCell()).toBeNull()
  })

  it('键盘聚焦格子触发；格子滚出视口 / 被回收停止；stop() 立即停止', () => {
    const { root, cells } = grid()
    const c = recorder()
    const io = fakeObserver()
    const bound = bindGridPreview(
      root as unknown as HTMLElement,
      opts,
      c,
      io.Ctor
    )
    root.fire('focusin', { target: cells[1] })
    expect(c.log).toEqual(['enter:item-2:preview'])
    io.hide()
    expect(c.log.at(-1)).toBe('leave:item-2')
    expect(io.live()).toBe(0)
    root.fire('focusin', { target: cells[0] })
    bound.stop()
    expect(c.log.at(-1)).toBe('leave:item-1')
    bound.unbind()
    root.fire('pointerover', { pointerType: 'mouse', target: cells[0] })
    expect(c.log.at(-1)).toBe('leave:item-1')
  })

  it('来源为 null（多选模式）的格子不触发', () => {
    const { root, cells } = grid()
    const c = recorder()
    bindGridPreview(
      root as unknown as HTMLElement,
      { ...opts, source: () => null },
      c,
      fakeObserver().Ctor
    )
    root.fire('pointerover', { pointerType: 'mouse', target: cells[0] })
    expect(c.log).toEqual([])
  })
})
