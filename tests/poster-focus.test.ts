// @vitest-environment jsdom
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type FaceBox,
  type FocusTransport,
  createFocusClient,
} from '../src/renderer/src/services/thumbnails/focus'
import { FOCUS_VERSION, type MediaFocus } from '../src/shared/media-focus'

/**
 * 渲染层的海报取景：图片加载后，只有会被裁的（图与框比例不同）才要焦点；
 * 同一轮加载的合并成一次请求、同时只有一个请求在途、离开页面的图不再请求（可取消）；
 * 焦点到手后写 object-position（不重新编码图片）；有 FaceDetector 时在后台逐张细化并写回。
 */

const SRC = (n: number): string =>
  `yingbox-media://image/${String(n).padStart(32, 'a')}?w=300`
const skin = (x: number, extra: Partial<MediaFocus> = {}): MediaFocus => ({
  v: FOCUS_VERSION,
  x,
  y: 0.3,
  by: 'skin',
  ...extra,
})

/** jsdom 不解码图片：手动给出天然尺寸。 */
function image(src: string, width = 800, height = 538): HTMLImageElement {
  const img = document.createElement('img')
  img.setAttribute('src', src)
  Object.defineProperty(img, 'naturalWidth', { value: width })
  Object.defineProperty(img, 'naturalHeight', { value: height })
  document.body.append(img)
  return img
}

const settle = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 60))

/** 可控的传输层：记录每次请求，按 answer 回答。 */
interface FakeTransport extends FocusTransport {
  calls: string[][]
  saved: Array<[string, MediaFocus]>
  hold: Promise<void> | null
  get: Mock<FocusTransport['get']>
  save: Mock<FocusTransport['save']>
}

function transport(
  answer: (url: string) => MediaFocus | null = () => skin(0.8)
): FakeTransport {
  const t: FakeTransport = {
    calls: [] as string[][],
    saved: [] as Array<[string, MediaFocus]>,
    hold: null as null | Promise<void>,
    get: vi.fn(async (urls: string[]) => {
      t.calls.push(urls)
      if (t.hold) await t.hold
      return urls.map(answer)
    }),
    save: vi.fn(async (url: string, focus: MediaFocus) => {
      t.saved.push([url, focus])
    }),
  }
  return t
}

const PORTRAIT = 2 / 3

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('取景：请求与应用', () => {
  it('横图进竖框：要焦点，写 object-position', async () => {
    const t = transport()
    const client = createFocusClient(t)
    const img = image(SRC(1))
    client.apply(img, PORTRAIT)
    await settle()
    expect(t.calls).toEqual([[SRC(1)]])
    // 1.487 的图进 2:3：可见宽 0.448，焦点 0.8 → 贴右
    expect(img.style.objectPosition).toBe('100% 50%')
  })

  it('同一轮加载的合并成一次请求', async () => {
    const t = transport()
    const client = createFocusClient(t)
    for (const n of [1, 2, 3]) client.apply(image(SRC(n)), PORTRAIT)
    await settle()
    expect(t.calls).toEqual([[SRC(1), SRC(2), SRC(3)]])
  })

  it('比例一致（竖海报进竖框）：不请求、不写样式', async () => {
    const t = transport()
    const img = image(SRC(1), 400, 600)
    createFocusClient(t).apply(img, PORTRAIT)
    await settle()
    expect(t.calls).toEqual([])
    expect(img.style.objectPosition).toBe('')
  })

  it('不是缩略图地址（远程原图）：不请求', async () => {
    const t = transport()
    createFocusClient(t).apply(image('https://img.test/a.jpg'), PORTRAIT)
    await settle()
    expect(t.calls).toEqual([])
  })

  it('网页端的服务地址也认（/media/image、/media/thumb）', async () => {
    const t = transport()
    const client = createFocusClient(t)
    client.apply(image(`/media/image/${'b'.repeat(32)}?w=300`), PORTRAIT)
    client.apply(
      image('/media/thumb?w=300&src=https%3A%2F%2Fx.test%2Fa.jpg'),
      PORTRAIT
    )
    await settle()
    expect(t.calls[0]).toHaveLength(2)
  })

  it('请求发出前离开页面（虚拟网格回收）：不请求', async () => {
    const t = transport()
    const client = createFocusClient(t)
    const gone = image(SRC(1))
    client.apply(gone, PORTRAIT)
    client.apply(image(SRC(2)), PORTRAIT)
    gone.remove()
    await settle()
    expect(t.calls).toEqual([[SRC(2)]])
  })

  it('同时只有一个请求在途；在途时加载的排到下一批', async () => {
    const t = transport()
    let release!: () => void
    t.hold = new Promise(resolve => (release = resolve))
    const client = createFocusClient(t)
    client.apply(image(SRC(1)), PORTRAIT)
    await settle()
    client.apply(image(SRC(2)), PORTRAIT)
    await settle()
    expect(t.calls).toEqual([[SRC(1)]])
    t.hold = null
    release()
    await settle()
    expect(t.calls).toEqual([[SRC(1)], [SRC(2)]])
  })

  it('一批最多 24 张，其余下一批', async () => {
    const t = transport()
    const client = createFocusClient(t)
    for (let n = 0; n < 30; n++) client.apply(image(SRC(n)), PORTRAIT)
    await settle()
    await settle()
    expect(t.calls.map(c => c.length)).toEqual([24, 6])
  })

  it('已知焦点：再次加载同步写样式，不再请求', async () => {
    const t = transport()
    const client = createFocusClient(t)
    client.apply(image(SRC(1)), PORTRAIT)
    await settle()
    const again = image(SRC(1))
    client.apply(again, PORTRAIT)
    expect(again.style.objectPosition).toBe('100% 50%')
    await settle()
    expect(t.calls).toHaveLength(1)
  })

  it('换了图（同一个元素 src 变了）：旧结果不落到新图上', async () => {
    const t = transport()
    let release!: () => void
    t.hold = new Promise(resolve => (release = resolve))
    const client = createFocusClient(t)
    const img = image(SRC(1))
    client.apply(img, PORTRAIT)
    await settle()
    img.setAttribute('src', SRC(9))
    t.hold = null
    release()
    await settle()
    expect(img.style.objectPosition).toBe('')
  })

  it('没有焦点（null）：保持居中，不写样式', async () => {
    const t = transport(() => null)
    const img = image(SRC(1))
    createFocusClient(t).apply(img, PORTRAIT)
    await settle()
    expect(img.style.objectPosition).toBe('')
  })

  it('请求失败：不抛到界面，下一批照常', async () => {
    const t = transport()
    t.get.mockRejectedValueOnce(new Error('boom'))
    const client = createFocusClient(t)
    const first = image(SRC(1))
    client.apply(first, PORTRAIT)
    await settle()
    client.apply(image(SRC(2)), PORTRAIT)
    await settle()
    expect(t.get.mock.calls.map(([urls]) => urls)).toEqual([[SRC(1)], [SRC(2)]])
    expect(first.style.objectPosition).toBe('')
  })
})

describe('取景：FaceDetector 细化（Windows / macOS）', () => {
  const box = (x: number, y: number, size: number): FaceBox => ({
    x,
    y,
    width: size,
    height: size,
  })

  it('检到脸：取正面框里最大的那张，写回并更新样式', async () => {
    const t = transport(() => skin(0.9, { box: [0.52, 0, 1, 1] }))
    const detect = vi.fn(async () => [
      box(40, 100, 120),
      box(440, 120, 90),
      box(560, 80, 60),
    ])
    const img = image(SRC(1))
    createFocusClient(t, detect).apply(img, PORTRAIT)
    await settle()
    await settle()
    expect(detect).toHaveBeenCalledWith(img)
    const [url, focus] = t.saved[0]!
    expect(url).toBe(SRC(1))
    expect(focus).toMatchObject({ by: 'face', box: [0.52, 0, 1, 1] })
    expect(focus.x).toBeCloseTo(485 / 800, 3)
    expect(focus.y).toBeCloseTo(165 / 538, 3)
    // 0.606 在框里放不下整窗：窗口左缘顶到框左缘 0.52 → 0.52 / 0.552 ≈ 94%
    expect(img.style.objectPosition).toBe('94% 50%')
  })

  it('没检到脸：记一笔已检测，下次不再检', async () => {
    const t = transport()
    const detect = vi.fn(async () => [])
    createFocusClient(t, detect).apply(image(SRC(1)), PORTRAIT)
    await settle()
    await settle()
    expect(t.saved).toEqual([[SRC(1), { ...skin(0.8), checked: true }]])
  })

  it('已是人脸结果或已检测过：不再检', async () => {
    const t = transport(url =>
      url === SRC(1) ? skin(0.4, { by: 'face' }) : skin(0.4, { checked: true })
    )
    const detect = vi.fn(async () => [])
    const client = createFocusClient(t, detect)
    client.apply(image(SRC(1)), PORTRAIT)
    client.apply(image(SRC(2)), PORTRAIT)
    await settle()
    await settle()
    expect(detect).not.toHaveBeenCalled()
  })

  it('平台没有实现（Linux：NotSupportedError）：之后不再尝试，也不写回', async () => {
    const t = transport()
    const detect = vi.fn(async () => {
      throw new DOMException(
        'Face Detection not implemented.',
        'NotSupportedError'
      )
    })
    const client = createFocusClient(t, detect)
    client.apply(image(SRC(1)), PORTRAIT)
    client.apply(image(SRC(2)), PORTRAIT)
    await settle()
    await settle()
    expect(detect).toHaveBeenCalledTimes(1)
    expect(t.saved).toEqual([])
  })

  it('检测排队时图片离开页面：跳过', async () => {
    const t = transport()
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const detect = vi.fn(async () => {
      await gate
      return []
    })
    const client = createFocusClient(t, detect)
    const first = image(SRC(1))
    const second = image(SRC(2))
    client.apply(first, PORTRAIT)
    client.apply(second, PORTRAIT)
    await settle()
    second.remove()
    release()
    await settle()
    expect(detect).toHaveBeenCalledTimes(1)
  })
})

describe('网页端传输：片库服务 /media/focus', () => {
  it('serverFocus / serverSaveFocus 发同源 JSON POST', async () => {
    const { serverFocus, serverSaveFocus } =
      await import('../src/renderer/src/services/library-server')
    const { LIBRARY_HTTP } = await import('../src/shared/library/ipc')
    const fetch = vi.fn(
      async (_path: string, _init: RequestInit) =>
        new Response(JSON.stringify({ focus: [skin(0.4), null] }), {
          status: 200,
        })
    )
    vi.stubGlobal('fetch', fetch)
    try {
      expect(await serverFocus(['/media/image/a', 'x'])).toEqual([
        skin(0.4),
        null,
      ])
      expect(fetch.mock.calls[0]![0]).toBe(LIBRARY_HTTP.focus)
      expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({
        urls: ['/media/image/a', 'x'],
      })
      fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
      await serverSaveFocus('/media/image/a', skin(0.5, { by: 'face' }))
      expect(fetch.mock.calls[1]![0]).toBe(LIBRARY_HTTP.focusSave)
      expect(JSON.parse(String(fetch.mock.calls[1]![1].body))).toEqual({
        url: '/media/image/a',
        focus: skin(0.5, { by: 'face' }),
      })
      fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
      await expect(serverFocus(['x'])).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
