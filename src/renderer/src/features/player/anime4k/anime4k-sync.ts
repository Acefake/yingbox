/**
 * 把 Anime4K 设置（player.anime4k*）同步给主进程。
 * 主进程据此在 mpv 播放时按需下载并挂载着色器；开播前与设置变化时各调用一次。
 */
import { getSetting } from '@/features/settings'

import type { Anime4kConfig } from '@shared/anime4k'

/** 当前设置组成的配置（普通对象，可直接走 IPC）。 */
export function anime4kConfig(): Anime4kConfig {
  return {
    enabled: getSetting('player.anime4k'),
    mode: getSetting('player.anime4kMode'),
    quality: getSetting('player.anime4kQuality'),
    animeOnly: getSetting('player.anime4kAnimeOnly'),
  }
}

/** 同步给主进程；网页端没有 mpv 接口时什么都不做。 */
export function syncAnime4k(): void {
  const api = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (!api?.setAnime4k) return
  void api.setAnime4k(anime4kConfig()).catch(() => {})
}
