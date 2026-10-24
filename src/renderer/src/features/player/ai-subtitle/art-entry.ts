/**
 * 播放器设置菜单里的「字幕与 AI 字幕」入口：已挂上字幕后 CC 按钮只切换显示，
 * 从这里仍能打开字幕面板（AI 生成字幕、在线搜索）。
 */
import type Artplayer from 'artplayer'

/** 在设置菜单加入口；菜单不可用时静默跳过 */
export function installSubtitlePanelEntry(
  art: Artplayer,
  open: () => void
): void {
  try {
    art.setting.add({
      name: 'ybSubtitlePanel',
      html: '字幕与 AI 字幕',
      onClick() {
        this.setting.show = false
        open()
      },
    })
  } catch {
    // 设置菜单不可用时不影响播放
  }
}
