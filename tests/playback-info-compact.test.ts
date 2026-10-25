// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import type Artplayer from 'artplayer'

import {
  closePlaybackInfo,
  installPlaybackInfo,
} from '../src/renderer/src/features/player/playback-info/playback-info'

/** 假的 Artplayer：只留播放信息用到的部分，记下设置菜单项的点击 */
function fakeArt(): { art: Artplayer; layer: HTMLElement; click: () => void } {
  const layer = document.createElement('div')
  let onClick = (): void => {}
  const art = {
    video: document.createElement('video'),
    url: 'http://x/a.mp4',
    layers: {
      add: ({ html }: { html: string }) => {
        layer.innerHTML = html
        return layer
      },
    },
    setting: {
      show: false,
      add: (item: { onClick: () => void }) => (onClick = item.onClick),
    },
    contextmenu: { show: false, add: () => {} },
    notice: { show: '' },
    on: () => {},
  } as unknown as Artplayer
  return { art, layer, click: () => onClick() }
}

/** 播放信息与角落小窗（PR #149 审查） */
describe('播放信息：小窗', () => {
  it('缩进小窗时 closePlaybackInfo 收起已展开的浮层', () => {
    const { art, layer, click } = fakeArt()
    installPlaybackInfo(
      art,
      () => null,
      () => false
    )
    click()
    expect(layer.classList.contains('is-open')).toBe(true)
    closePlaybackInfo(art)
    expect(layer.classList.contains('is-open')).toBe(false)
  })

  it('小窗里点「播放信息」不展开，只给提示', () => {
    const { art, layer, click } = fakeArt()
    installPlaybackInfo(
      art,
      () => null,
      () => true
    )
    click()
    expect(layer.classList.contains('is-open')).toBe(false)
    expect(art.notice.show).toBe('展开播放器后再打开')
  })
})
