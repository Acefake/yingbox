import { getSetting, setSetting } from '@/features/settings'

/** 把上次的音量与静音套到新建的播放器（换集、重开都沿用，不回到 100%）。 */
export function restoreVolume(video: HTMLVideoElement): void {
  video.volume = getSetting('player.volume')
  video.muted = getSetting('player.muted')
}

/**
 * 记住用户刚设的音量与静音。只在用户操作处调用：睡眠定时的渐弱也会改 video.volume，
 * 不能当成用户的选择存下来。
 */
export function rememberVolume(video: HTMLVideoElement): void {
  void setSetting('player.volume', video.volume)
  void setSetting('player.muted', video.muted)
}
