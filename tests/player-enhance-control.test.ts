// @vitest-environment jsdom
import Artplayer from 'artplayer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installEnhanceControl } from '../src/renderer/src/features/player/enhance/enhance-control'
import { transportControls } from '../src/renderer/src/features/player/utils/art-transport'

vi.mock('@/features/settings', () => ({
  getSetting: () => 'standard',
  setSetting: vi.fn(),
}))
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
let art: Artplayer

afterEach(() => art.destroy())

function setup(): (state: string) => void {
  const container = document.createElement('div')
  document.body.append(container)
  art = new Artplayer({ container, url: '', controls: transportControls() })
  return installEnhanceControl(art)
}

describe('增强状态和控件位置', () => {
  it('只有增强生效才显示标识，对比时显示原画，失败或关闭隐藏', () => {
    const report = setup()
    const badge =
      art.template.$player.querySelector<HTMLElement>('[role="status"]')!
    expect(badge.hidden).toBe(true)
    report('FSR')
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('FSR 增强')
    report('原画')
    expect(badge.textContent).toBe('原画对比')
    for (const state of ['处理失败', '不支持', '等待处理', '']) {
      report(state)
      expect(badge.hidden).toBe(true)
    }
  })

  it('增强在右侧，对比紧邻增强左侧', () => {
    setup()
    const right = art.template.$controlsRight
    const compare = right.querySelector('.art-control-ybCompare')!
    expect(compare.nextElementSibling).toBe(
      right.querySelector('.art-control-ybEnhance')
    )
    expect(
      art.template.$controlsLeft.querySelector('.art-control-ybEnhance')
    ).toBeNull()
  })
})
