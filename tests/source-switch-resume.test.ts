/**
 * 播放中换源的续播位置（use-source-switch）：连续换源失败时保留本轮的目标位置，
 * 直到某个备用源真正开播才更新。
 */
import { describe, expect, it, vi } from 'vitest'
import { type Ref, ref } from 'vue'

vi.mock('@/features/settings', () => ({
  getSetting: (key: string) => (key === 'online.stallSeconds' ? 8 : true),
}))

const { useSourceSwitch } =
  await import('../src/renderer/src/features/player/composables/use-source-switch')

/** 只有 currentTime 与事件的假 <video> */
const fakeVideo = (currentTime: number): HTMLVideoElement => {
  const el = new EventTarget() as EventTarget & { currentTime: number }
  el.currentTime = currentTime
  return el as unknown as HTMLVideoElement
}

const setup = (): {
  switcher: ReturnType<typeof useSourceSwitch>
  loads: number[]
  activeFallback: Ref<number>
} => {
  const entry = (siteName: string): Record<string, string> => ({
    url: `https://${siteName}.test/v.m3u8`,
    siteName,
    title: '第1集',
  })
  const loads: number[] = []
  const activeFallback = ref(-1)
  const switcher = useSourceSwitch({
    fallbacks: ref([entry('b'), entry('c'), entry('d')]) as never,
    activeFallback,
    current: () => null,
    notify: () => {},
    load: async at => {
      loads.push(at)
      // 和 PlayerSession 一样：每次加载换一个新的 <video>，还没加载出元数据时 currentTime 为 0
      switcher.attach(fakeVideo(0))
    },
  })
  return { switcher, loads, activeFallback }
}

describe('换源续播位置', () => {
  it('备用源开播前就失败：下一个备用源仍从主源的位置继续', async () => {
    const { switcher, loads } = setup()
    switcher.attach(fakeVideo(1394))
    expect(await switcher.switchSource('stall')).toBe(true)
    expect(await switcher.switchSource('error')).toBe(true)
    expect(loads).toEqual([1394, 1394])
  })

  it('某个备用源开播后，再换源按它当时的进度', async () => {
    const { switcher, loads } = setup()
    switcher.attach(fakeVideo(1394))
    await switcher.switchSource('stall')
    const playing = fakeVideo(1500)
    switcher.attach(playing)
    playing.dispatchEvent(new Event('playing'))
    await switcher.switchSource('stall')
    expect(loads).toEqual([1394, 1500])
  })

  it('换完一轮或回到主源（重试 / 连播）后重新取位置', async () => {
    const { switcher, loads, activeFallback } = setup()
    switcher.attach(fakeVideo(100))
    for (let i = 0; i < 3; i++) await switcher.switchSource('error')
    expect(await switcher.switchSource('error')).toBe(false)
    activeFallback.value = -1
    switcher.attach(fakeVideo(42))
    await switcher.switchSource('error')
    expect(loads).toEqual([100, 100, 100, 42])
  })
})
