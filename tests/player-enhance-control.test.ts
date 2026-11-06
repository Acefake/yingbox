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
  it('增强状态继续回报，播放画面不显示增强或原画提示', () => {
    const report = setup()
    for (const state of ['FSR', '原画', '处理失败', '不支持', '等待处理', '']) {
      report(state)
      expect(art.video.dataset.ybEnhanceState).toBe(state)
      expect(
        art.template.$player.querySelector('.yb-enhance-status')
      ).toBeNull()
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
