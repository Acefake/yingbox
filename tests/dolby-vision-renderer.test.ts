/**
 * 渲染层杜比视界控制（use-dolby-vision）：媒体库已知不是 P5 时不探测、不开重建；
 * 准备期间关闭 / 换集时停掉迟到的会话；重建做不了按设置转 mpv，mpv 打不开或设置关着时直接播并提示；
 * 重建会话播放中出错时退一次（recover），之后这个文件直接播。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const settings: Record<string, unknown> = {
  'player.dvAutoMpv': true,
  'player.applyDolbyVision': true,
}
const closePlayerModal = vi.fn()

vi.mock('@/features/settings', () => ({
  getSetting: (key: string) => settings[key],
}))
vi.mock('@/components/ui', () => ({ toast: { info: vi.fn() } }))
vi.mock('../src/renderer/src/features/player/modal/player-modal', () => ({
  closePlayerModal: () => closePlayerModal(),
}))

const { useDolbyVision } =
  await import('../src/renderer/src/features/player/dolby-vision/use-dolby-vision')
const { DV_DIRECT_WARNING, DV_HANDED_OFF_TEXT } =
  await import('../src/renderer/src/features/player/dolby-vision/dv-rules')

/** 主进程 probe 的返回与媒体库存的同一形状（shared/video-range 的 VideoProbe） */
const P5_INFO = { range: 'dv', dvProfile: 5, dvCompat: 0 }
const STREAM = {
  kind: 'stream',
  id: 's1',
  url: 'http://127.0.0.1:5000/tok/index.m3u8',
}
const FILE = '/m/p5.mkv'
const DIRECT = 'local:////m/p5.mkv'

interface FakeApi {
  probe: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}
let dv: FakeApi
let mpvOpen: ReturnType<typeof vi.fn>

/** 建一份控制，返回它和界面出口 */
function setup(): {
  control: ReturnType<typeof useDolbyVision>
  notify: ReturnType<typeof vi.fn>
  emptyText: { value: string }
} {
  const notify = vi.fn()
  const emptyText = ref('')
  const control = useDolbyVision({ src: ref('old'), emptyText, notify })
  return { control, notify, emptyText }
}

const request = (
  over: Record<string, unknown> = {}
): Parameters<ReturnType<typeof useDolbyVision>['resolve']>[0] => ({
  filePath: FILE,
  title: 'P5',
  startAt: 0,
  isCurrent: () => true,
  ...over,
})

beforeEach(() => {
  settings['player.dvAutoMpv'] = true
  dv = {
    probe: vi.fn(async () => P5_INFO),
    start: vi.fn(async () => STREAM),
    stop: vi.fn(async () => true),
  }
  mpvOpen = vi.fn(async () => ({ success: false }))
  vi.stubGlobal('window', {
    api: { dolbyVision: dv, mpv: { open: mpvOpen } },
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
  })
  closePlayerModal.mockReset()
})

afterEach(() => vi.unstubAllGlobals())

describe('useDolbyVision', () => {
  it('媒体库已知不是 P5：直接播，不探测也不开重建', async () => {
    const { control } = setup()
    const url = await control.resolve(
      request({ known: { dvProfile: 8, dvCompat: 1 } })
    )
    expect(url).toBe(DIRECT)
    expect(dv.probe).not.toHaveBeenCalled()
    expect(dv.start).not.toHaveBeenCalled()
  })

  it('媒体库已知是 P5：跳过探测，直接开重建拿到本机 HLS 地址', async () => {
    const { control } = setup()
    const url = await control.resolve(
      request({ known: { dvProfile: 5, dvCompat: 0 } })
    )
    expect(url).toBe(STREAM.url)
    expect(dv.probe).not.toHaveBeenCalled()
    expect(dv.start).toHaveBeenCalledOnce()
  })

  it('媒体库没探测过：请主进程识别，P8.1 直接播、P5 才开重建', async () => {
    dv.probe.mockResolvedValueOnce({ range: 'dv', dvProfile: 8, dvCompat: 1 })
    const { control } = setup()
    expect(await control.resolve(request())).toBe(DIRECT)
    expect(dv.start).not.toHaveBeenCalled()
    expect(await control.resolve(request())).toBe(STREAM.url)
    expect(dv.probe).toHaveBeenCalledTimes(2)
    expect(dv.start).toHaveBeenCalledOnce()
  })

  it('准备期间被 release（关闭弹窗 / 换集）：迟到的会话立即停掉', async () => {
    let finish: (v: unknown) => void = () => {}
    dv.start.mockImplementation(() => new Promise(r => (finish = r)))
    const { control } = setup()
    const pending = control.resolve(request())
    await vi.waitFor(() => expect(dv.start).toHaveBeenCalled())
    control.release()
    finish(STREAM)
    expect(await pending).toBe(DIRECT)
    expect(dv.stop).toHaveBeenCalledWith('s1')
  })

  it('重建做不了、mpv 也打不开：直接播并在播放区提示色彩可能不对', async () => {
    dv.start.mockResolvedValue({ kind: 'fallback', reason: '无 Vulkan' })
    const { control, notify } = setup()
    expect(await control.resolve(request())).toBe(DIRECT)
    expect(mpvOpen).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith(DV_DIRECT_WARNING)
  })

  it('重建做不了、mpv 打开了：关掉弹窗，不再加载', async () => {
    dv.start.mockResolvedValue({ kind: 'fallback', reason: '无 Vulkan' })
    mpvOpen.mockResolvedValue({ success: true })
    const { control, emptyText } = setup()
    expect(await control.resolve(request())).toBe('')
    expect(closePlayerModal).toHaveBeenCalledOnce()
    expect(emptyText.value).toBe(DV_HANDED_OFF_TEXT)
  })

  it('设置「P5 自动用 mpv」关着：不试 mpv，直接播并提示', async () => {
    settings['player.dvAutoMpv'] = false
    dv.start.mockResolvedValue({ kind: 'fallback', reason: '无 Vulkan' })
    const { control, notify } = setup()
    expect(await control.resolve(request())).toBe(DIRECT)
    expect(mpvOpen).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(DV_DIRECT_WARNING)
  })

  it('重建会话播放中出错：停会话，mpv 打不开时要求重新加载，这次直接播', async () => {
    const { control } = setup()
    expect(await control.resolve(request())).toBe(STREAM.url)
    expect(await control.recover(30)).toBe('reload')
    expect(dv.stop).toHaveBeenCalledWith('s1')
    expect(mpvOpen).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: FILE, startAt: 30 })
    )
    expect(await control.resolve(request({ startAt: 30 }))).toBe(DIRECT)
    expect(dv.start).toHaveBeenCalledOnce()
    // 不是重建会话的错误照常处理
    expect(await control.recover(31)).toBeNull()
  })
})
