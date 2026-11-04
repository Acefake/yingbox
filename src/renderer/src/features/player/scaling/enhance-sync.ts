import { getSetting } from '@/features/settings'

/** 开播前与设置变化时把画质增强档位同步给 mpv。 */
export async function syncEnhance(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (!api?.setEnhance) return
  await api.setEnhance(getSetting('player.enhance'))
}
