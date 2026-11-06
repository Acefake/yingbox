// @vitest-environment jsdom
import Artplayer from 'artplayer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPointerControls } from '../src/renderer/src/features/player/controls/pointer-controls'
import { installPlayerHotkeys } from '../src/renderer/src/features/player/hotkeys/install-hotkeys'

vi.mock('@/features/settings', () => ({
  getSetting: () => 1,
  setSetting: vi.fn(),
}))

const instances: Artplayer[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  instances.forEach(art => art.destroy())
  instances.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function player(): Artplayer {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const container = document.createElement('div')
  document.body.append(container)
  const art = new Artplayer({ container, url: '', hotkey: false })
  instances.push(art)
  let paused = false
  Object.defineProperty(art.video, 'paused', { get: () => paused })
  vi.spyOn(art.video, 'pause').mockImplementation(() => {
    paused = true
    art.video.dispatchEvent(new Event('pause'))
  })
  vi.spyOn(art.video, 'play').mockImplementation(async () => {
    paused = false
    art.video.dispatchEvent(new Event('play'))
  })
  vi.spyOn(art.template.$player, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1000, 640)
  )
  vi.spyOn(art.template.$bottom, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 596, 1000, 44)
  )
  installPointerControls(art)
  return art
}

const click = (art: Artplayer, detail = 1): void => {
  art.video.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
}
const move = (art: Artplayer, y: number): void => {
  art.video.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientY: y })
  )
}
const hidden = (art: Artplayer): boolean =>
  art.template.$player.classList.contains('yb-controls-hidden')

describe('桌面播放与边缘控件', () => {
  it('清屏后移动鼠标立即恢复指针，同一区域持续移动不会隐藏指针', () => {
    const art = player()
    vi.advanceTimersByTime(2000)
    expect(art.template.$player.classList.contains('art-hide-cursor')).toBe(
      true
    )
    move(art, 320)
    expect(art.template.$player.classList.contains('art-hide-cursor')).toBe(
      false
    )
    expect(hidden(art)).toBe(true)
    vi.advanceTimersByTime(1500)
    move(art, 321)
    vi.advanceTimersByTime(1500)
    expect(art.template.$player.classList.contains('art-hide-cursor')).toBe(
      false
    )
    vi.advanceTimersByTime(500)
    expect(art.template.$player.classList.contains('art-hide-cursor')).toBe(
      true
    )
  })

  it('单击暂停并清屏，再单击继续播放并保持清屏', () => {
    const art = player()
    click(art)
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    expect(art.video.paused).toBe(true)
    expect(hidden(art)).toBe(true)
    move(art, 320)
    expect(hidden(art)).toBe(true)
    click(art)
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    expect(art.video.paused).toBe(false)
    expect(hidden(art)).toBe(true)
  })

  it('底边停留才唤出，暂停时保持，播放离开后2秒隐藏', () => {
    const art = player()
    click(art)
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    move(art, 620)
    vi.advanceTimersByTime(149)
    expect(hidden(art)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(hidden(art)).toBe(false)
    move(art, 320)
    vi.advanceTimersByTime(3000)
    expect(hidden(art)).toBe(false)
    void art.video.play()
    vi.advanceTimersByTime(1999)
    expect(hidden(art)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden(art)).toBe(true)
  })

  it('顶边只唤出顶栏；划过底边不会唤出控制条', () => {
    const art = player()
    click(art)
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    move(art, 620)
    vi.advanceTimersByTime(100)
    move(art, 320)
    vi.advanceTimersByTime(150)
    expect(hidden(art)).toBe(true)
    move(art, 20)
    vi.advanceTimersByTime(150)
    expect(art.template.$player.classList.contains('yb-header-visible')).toBe(
      true
    )
    expect(hidden(art)).toBe(true)
  })

  it('双击只转发一次，不暂停；控制按钮不触发空白单击', () => {
    const art = player()
    const double = vi.fn()
    art.on('dblclick', double)
    click(art)
    vi.advanceTimersByTime(100)
    click(art, 2)
    art.video.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    vi.advanceTimersByTime(1000)
    expect(double).toHaveBeenCalledOnce()
    expect(art.video.pause).not.toHaveBeenCalled()
    art.template.$bottom.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    expect(art.video.pause).not.toHaveBeenCalled()
  })

  it('mousemove仍可到达document；销毁取消待执行单击', () => {
    const art = player()
    const movement = vi.fn()
    document.addEventListener('mousemove', movement, { once: true })
    move(art, 620)
    expect(movement).toHaveBeenCalledOnce()
    click(art)
    art.destroy()
    instances.length = 0
    vi.advanceTimersByTime(1000)
    expect(art.video.pause).not.toHaveBeenCalled()
  })

  it('接入真实双击分区后不补偿播放；空格不改变控件显隐', () => {
    const art = player()
    Object.defineProperty(art.video, 'duration', { value: 100 })
    installPlayerHotkeys(art, {
      enabled: () => true,
      next: null,
      pin: null,
      subtitle: () => {},
    })
    click(art)
    vi.advanceTimersByTime(100)
    click(art, 2)
    art.video.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, clientX: 900 })
    )
    vi.advanceTimersByTime(500)
    expect(art.video.currentTime).toBe(10)
    expect(art.video.pause).not.toHaveBeenCalled()
    click(art)
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    expect(art.video.paused).toBe(false)
    expect(hidden(art)).toBe(true)
    expect(art.template.$player.querySelectorAll('.yb-osd')).toHaveLength(1)
  })

  it('超过播放器双击窗口的两次点击按两次单击处理', () => {
    const art = player()
    const double = vi.fn()
    art.on('dblclick', double)
    click(art)
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME + 100)
    expect(art.video.paused).toBe(true)
    click(art, 2)
    art.video.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    vi.advanceTimersByTime(Artplayer.DBCLICK_TIME)
    expect(art.video.paused).toBe(false)
    expect(double).not.toHaveBeenCalled()
  })

  it('从窗口边缘离开也会自动隐藏', () => {
    const art = player()
    move(art, 620)
    vi.advanceTimersByTime(150)
    document.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(2000)
    expect(hidden(art)).toBe(true)
  })

  it('拖动进度离开控制区时保持可见，松手后才计时隐藏', () => {
    const art = player()
    move(art, 620)
    vi.advanceTimersByTime(150)
    art.template.$bottom.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true })
    )
    move(art, 320)
    vi.advanceTimersByTime(3000)
    expect(hidden(art)).toBe(false)
    document.dispatchEvent(new MouseEvent('pointerup'))
    vi.advanceTimersByTime(2000)
    expect(hidden(art)).toBe(true)
  })
})
