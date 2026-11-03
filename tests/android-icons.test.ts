import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  ANDROID_ICONS_FILE,
  generateAndroidIcons,
} from '../scripts/gen-android-icons'

describe('安卓图标（与桌面同一份 Phosphor）', () => {
  it('仓库里的 Icons.kt 与图标表一致（不一致时运行 pnpm gen:android-icons）', () => {
    expect(readFileSync(ANDROID_ICONS_FILE, 'utf8')).toBe(
      generateAndroidIcons()
    )
  })

  it('默认字重用图标名，另一档加后缀；不认识的图标直接报错', () => {
    const kotlin = generateAndroidIcons(['heart'])
    expect(kotlin).toContain('val Heart: ImageVector')
    expect(kotlin).toContain('val HeartFill: ImageVector')
    expect(() => generateAndroidIcons(['nope'])).toThrow('nope')
  })
})
