import type Artplayer from 'artplayer'

import logo from '@/assets/imgs/fsr-logo.png'

import './fsr-mark.css'

/**
 * 右上角的 FSR 字标：增强生效时显示，没有背景；按住对比原画时变暗。
 * 状态由增强处理器经 video.dataset.ybEnhanceState 回报（FSR / 原画），随播放器控制层显隐。
 */
export function installFsrMark(art: Artplayer): void {
  const img = document.createElement('img')
  img.className = 'yb-fsr-mark'
  img.src = logo
  img.alt = 'AMD FSR'
  img.draggable = false
  img.hidden = true
  art.layers.add({ name: 'ybFsrMark', html: img })
  const refresh = (): void => {
    const state = art.video.dataset.ybEnhanceState ?? ''
    img.hidden = state !== 'FSR' && state !== '原画'
    img.classList.toggle('is-original', state === '原画')
    img.title = `画质增强：AMD FSR 1.0 放大与锐化（非 AI 超分）`
  }
  art.on('yb:enhance-update', refresh)
  refresh()
}
