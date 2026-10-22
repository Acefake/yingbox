// @vitest-environment jsdom
import { type Component, createApp, defineComponent, h, nextTick } from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 网页端媒体库的页内播放器（原生 <video> + 片库服务 Range 流）接入小窗：
 * 关闭详情（?item= 去掉）或切走路由时播放中 → 同一个 <video> 进小窗；回到详情 → 回到播放层；
 * 暂停中关闭详情、换到别的条目、小窗里关闭 → 正常拆除。
 */

vi.mock('../src/renderer/src/services/library-server', () => ({
  serverFileUrl: (id: number) => `https://nas.local/media/files/${id}`,
}))

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

let web: typeof import('../src/renderer/src/features/library/detail/web-player')
let dock: typeof import('../src/renderer/src/features/player/mini/mini-dock')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  document.body.innerHTML = ''
  web = await import('../src/renderer/src/features/library/detail/web-player')
  dock = await import('../src/renderer/src/features/player/mini/mini-dock')
})

async function mountLibrary(): Promise<{
  router: ReturnType<typeof createRouter>
  unmount: () => void
}> {
  const { default: WebPlayer } =
    await import('../src/renderer/src/features/library/detail/WebPlayer.vue')
  const { MiniPlayer } = await import('../src/renderer/src/features/player')
  const Library = defineComponent({
    setup: () => () => h('div', [h(WebPlayer as Component)]),
  })
  const Elsewhere = defineComponent({ setup: () => () => h('p', '别处') })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/movie', component: Library },
      { path: '/elsewhere', component: Elsewhere },
    ],
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(
    defineComponent({
      setup: () => () => [h(RouterView), h(MiniPlayer as Component)],
    })
  ).use(router)
  await router.push('/movie?item=7')
  await router.isReady()
  app.mount(root)
  await settle()
  return { router, unmount: () => app.unmount() }
}

const open = (): void => {
  web.openWebPlayer({
    title: '片名',
    files: [
      { fileId: 1, name: '上' },
      { fileId: 2, name: '下' },
    ],
    index: 0,
  })
}
const overlay = (): HTMLElement | null =>
  document.querySelector('.web-player')
const slot = (): HTMLElement | null =>
  document.querySelector('[data-mini-slot]')

describe('网页端媒体库播放器 → 小窗', () => {
  it('播放中关闭详情：同一个 <video> 进小窗、地址不变；回到详情：回到播放层', async () => {
    const t = await mountLibrary()
    open()
    await settle()
    const video = overlay()!.querySelector('video')!
    expect(video.src).toBe('https://nas.local/media/files/1')
    setPlaying(video)

    await t.router.push('/movie')
    await settle()
    expect(slot()?.contains(video)).toBe(true)
    expect(overlay()).toBeNull()
    expect(video.src).toBe('https://nas.local/media/files/1')

    document
      .querySelector<HTMLButtonElement>('[aria-label="回到详情"]')!
      .click()
    await settle()
    expect(t.router.currentRoute.value.fullPath).toBe('/movie?item=7')
    expect(overlay()?.contains(video)).toBe(true)
    expect(slot()?.contains(video)).toBe(false)
    expect(dock.miniSession().value).toBeNull()
    t.unmount()
  })

  it('播放中切走路由：进小窗', async () => {
    const t = await mountLibrary()
    open()
    await settle()
    const video = overlay()!.querySelector('video')!
    setPlaying(video)
    await t.router.push('/elsewhere')
    await settle()
    expect(slot()?.contains(video)).toBe(true)
    t.unmount()
  })

  it('暂停中关闭详情：正常拆除', async () => {
    const t = await mountLibrary()
    open()
    await settle()
    await t.router.push('/movie')
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(web.webPlayback().value).toBeNull()
    t.unmount()
  })

  it('换到别的条目（?item= 变了）：正常拆除，不进小窗', async () => {
    const t = await mountLibrary()
    open()
    await settle()
    setPlaying(overlay()!.querySelector('video')!)
    await t.router.push('/movie?item=8')
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(web.webPlayback().value).toBeNull()
    t.unmount()
  })

  it('小窗里关闭：拆除；小窗开着时再打开别的文件：先拆旧的', async () => {
    const t = await mountLibrary()
    open()
    await settle()
    const video = overlay()!.querySelector('video')!
    setPlaying(video)
    await t.router.push('/movie')
    await settle()
    document
      .querySelector<HTMLButtonElement>('[aria-label="关闭小窗"]')!
      .click()
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(web.webPlayback().value).toBeNull()
    expect(video.isConnected).toBe(false)

    await t.router.push('/movie?item=7')
    open()
    await settle()
    const again = overlay()!.querySelector('video')!
    setPlaying(again)
    await t.router.push('/movie')
    await settle()
    expect(dock.miniSession().value).not.toBeNull()
    web.openWebPlayer({ title: '另一部', files: [{ fileId: 9, name: '' }], index: 0 })
    await settle()
    expect(dock.miniSession().value).toBeNull()
    expect(web.webPlayback().value?.title).toBe('另一部')
    t.unmount()
  })

  it('画中画按钮：支持时显示，点了调 requestPictureInPicture', async () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    })
    const t = await mountLibrary()
    open()
    await settle()
    const video = overlay()!.querySelector('video')!
    const request = vi.fn(async () => ({}) as PictureInPictureWindow)
    video.requestPictureInPicture = request
    document
      .querySelector<HTMLButtonElement>('[aria-label="画中画"]')!
      .click()
    expect(request).toHaveBeenCalledTimes(1)
    t.unmount()
  })
})
