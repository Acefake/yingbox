import { getSetting } from '@/features/settings'

/** 开播前与设置变化时同步 mpv 的高质量缩放开关。 */
export async function syncHighQualityScaling(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (!api?.setHighQualityScaling) return
  await api.setHighQualityScaling(getSetting('player.highQualityScaling'))
}
