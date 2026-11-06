/** uosc 控制条（resources/mpv-ui）：打包后在 resourcesPath/mpv-ui，开发时在项目 resources 里；找不到就用 mpv 自带的 osc。 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function mpvUiDir(): string | null {
  const roots = [
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    join(app.getAppPath(), 'resources'),
  ].filter(Boolean)
  for (const root of roots) {
    const dir = join(root, 'mpv-ui')
    if (existsSync(join(dir, 'scripts', 'uosc', 'main.lua'))) return dir
  }
  return null
}
