/**
 * 安卓端图标 → Kotlin：从桌面同一份 Phosphor 图标（src/renderer/src/components/ui/icons.ts）里
 * 取安卓用到的几个，生成 ImageVector。默认字重用图标名，另一档字重加后缀（HeartFill）。
 *
 *   pnpm gen:android-icons
 *
 * tests/android-icons.test.ts 重新生成并与仓库里的文件比较，表改了却没重新生成时测试失败。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ICONS,
  type IconDef,
  type IconWeight,
} from '../src/renderer/src/components/ui/icons'

export const ANDROID_ICONS_FILE = join(
  __dirname,
  '../android/app/src/main/kotlin/com/yingbox/android/ui/Icons.kt'
)

/** 安卓用到的图标（增删在这里改，再重新生成） */
export const ANDROID_ICONS = [
  'home',
  'history',
  'heart',
  'back',
  'forward',
  'search',
  'settings',
  'play',
  'star',
] as const satisfies readonly (keyof typeof ICONS)[]

const pascal = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1)

const suffix: Record<IconWeight, string> = { fill: 'Fill', bold: 'Bold' }

/** 生成 Icons.kt 的全文 */
export function generateAndroidIcons(
  names: readonly string[] = ANDROID_ICONS
): string {
  const entries = names.flatMap(name => {
    const def = (ICONS as Record<string, IconDef>)[name]
    if (!def) throw new Error(`没有这个图标：${name}`)
    return (['fill', 'bold'] as const)
      .filter(weight => def[weight])
      .map(weight => {
        const id = pascal(name) + (weight === def.weight ? '' : suffix[weight])
        return `    val ${id}: ImageVector by lazy { phosphor("${id}", "${def[weight]}") }`
      })
  })
  return `// 由 scripts/gen-android-icons.ts 从 src/renderer/src/components/ui/icons.ts 生成，不要手改。
// 增删图标改脚本里的 ANDROID_ICONS，再运行 pnpm gen:android-icons。
package com.yingbox.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** Phosphor 图标（MIT，256 视框），与桌面同一份；颜色由 Icon 的 tint 决定 */
object YbIcons {
${entries.join('\n')}
}

private fun phosphor(name: String, d: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 256f, 256f)
        .addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.Black))
        .build()
`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeFileSync(ANDROID_ICONS_FILE, generateAndroidIcons())
  console.log(`已生成 ${ANDROID_ICONS_FILE}`)
}
