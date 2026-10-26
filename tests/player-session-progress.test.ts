/**
 * 播放会话的进度记到开播时绑定的那一集：换集解析地址期间旧视频的 timeupdate 不会记到新的一集上，
 * 换集前上一集的位置会先写出。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/features/incognito', () => ({ isIncognito: () => false }))

const { relayProgress } =
  await import('../src/renderer/src/features/player/progress/progress-events')
const { useSessionProgress } =
  await import('../src/renderer/src/features/player/composables/use-session-progress')

type Ev = { kind: string; target?: { key: string; library?: unknown } }

const tick = (t: number): Event =>
  ({ target: { currentTime: t, duration: 1400 } }) as unknown as Event

describe('useSessionProgress 绑定当前集', () => {
  let events: Ev[] = []
  let restore = (): void => {}
  let now = 0

  beforeEach(() => {
    events = []
    restore = relayProgress(e => events.push(e as Ev))
    now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    restore()
    vi.restoreAllMocks()
  })

  const setup = () => {
    const playlist = ref([
      { filePath: '/tv/e1.mkv', library: { itemId: 1, fileId: 11 } },
      { filePath: '/tv/e2.mkv', library: { itemId: 2, fileId: 22 } },
    ])
    const position = ref(0)
    const progressKey = ref('/tv/e1.mkv')
    const p = useSessionProgress({
      progressKey,
      continueId: ref('c1'),
      playlist,
      position,
      current: () => playlist.value[position.value] ?? null,
      label: e => e?.filePath ?? '',
    })
    return { p, position, progressKey }
  }

  it('换集加载期间旧视频的进度不记到下一集', () => {
    const { p, position, progressKey } = setup()
    p.bind()
    now = 5000
    p.saver.onTimeUpdate(tick(600))
    // 手动下一集：位置与进度键先变，地址还在解析，旧视频继续播
    position.value = 1
    p.release()
    progressKey.value = '/tv/e2.mkv'
    now = 9000
    p.saver.onTimeUpdate(tick(610))
    const saves = events.filter(e => e.kind === 'save')
    expect(saves.map(e => e.target?.key)).toEqual(['/tv/e1.mkv', '/tv/e1.mkv'])
    expect(
      saves.every(e => (e.target?.library as { itemId: number }).itemId === 1)
    ).toBe(true)
    const cont = events.filter(e => e.kind === 'continue') as unknown as {
      update: { index: number }
    }[]
    expect(cont.every(e => e.update.index === 0)).toBe(true)

    // 下一集开播后才记到它名下
    p.bind()
    now = 12000
    p.saver.onTimeUpdate(tick(3))
    const last = events.filter(e => e.kind === 'save').at(-1)
    expect(last?.target?.key).toBe('/tv/e2.mkv')
  })
})
