/**
 * 播放器设置菜单与右键菜单里的「问剧情」「前情提要」入口。
 * 同一个播放器实例同一个入口只加一次；菜单不可用时静默跳过，不影响播放。
 */
import type Artplayer from 'artplayer'

/** 一个菜单入口 */
export interface RecapEntry {
  /** Artplayer 组件名（同实例内唯一） */
  name: string
  /** 菜单文案 */
  label: string
  open: () => void
}

const installed = new WeakMap<Artplayer, Set<string>>()

/** 在设置菜单和右键菜单各加一个入口 */
export function installRecapEntry(art: Artplayer, entry: RecapEntry): void {
  const names = installed.get(art) ?? new Set<string>()
  if (names.has(entry.name)) return
  names.add(entry.name)
  installed.set(art, names)
  try {
    art.setting.add({
      name: entry.name,
      html: entry.label,
      onClick() {
        this.setting.show = false
        entry.open()
      },
    })
  } catch {
    // 设置菜单不可用
  }
  try {
    art.contextmenu.add({
      name: entry.name,
      html: entry.label,
      click() {
        this.contextmenu.show = false
        entry.open()
      },
    })
  } catch {
    // 右键菜单不可用
  }
}
