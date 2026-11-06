/**
 * mpv 的控制条：uosc（默认）或 ModernZ，脚本随包放在 resources/mpv-ui/<名字>。
 * 打包后在 resourcesPath/mpv-ui，开发时在项目 resources 里；找不到或选「mpv 自带」就用 mpv 自带的 osc。
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type MpvUiKind = 'uosc' | 'modernz'

/** 要加载的控制条：名字 + 它在磁盘上的目录 */
export interface MpvUi {
  kind: MpvUiKind
  dir: string
}

/** 主脚本相对控制条目录的位置（也用来确认它真的在） */
const ENTRY: Record<MpvUiKind, string[]> = {
  uosc: ['scripts', 'uosc'],
  modernz: ['scripts', 'modernz.lua'],
}

/** 设置值 → 控制条；'default'（mpv 自带）或没找到文件返回 null */
export function locateMpvUi(setting: string): MpvUi | null {
  if (setting !== 'uosc' && setting !== 'modernz') return null
  const roots = [
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    join(app.getAppPath(), 'resources'),
  ].filter(Boolean)
  for (const root of roots) {
    const dir = join(root, 'mpv-ui', setting)
    if (existsSync(join(dir, ...ENTRY[setting]))) return { kind: setting, dir }
  }
  return null
}

/** 控制条对应的 mpv 命令行参数；ui 为空时用 mpv 自带的 osc */
export function mpvUiArgs(ui: MpvUi | null): string[] {
  if (!ui) return ['--osc=yes']
  const script = join(ui.dir, ...ENTRY[ui.kind])
  const fonts = `--osd-fonts-dir=${join(ui.dir, 'fonts')}`
  // 界面语言写死简体中文；值里不能带逗号，缺词条时自动用英文
  const language =
    ui.kind === 'uosc'
      ? '--script-opts=uosc-languages=zh-hans'
      : '--script-opts=modernz-language=zh'
  return ['--osc=no', '--osd-bar=no', `--script=${script}`, fonts, language]
}
