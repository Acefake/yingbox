/**
 * 图标表：icons.ts 由 scripts/gen-icons.mjs 从 Phosphor 生成，手改或改了表没重新生成都会失败；
 * 每个图标都有默认字重的路径。（模板里的图标名由 vue-tsc 按 IconName 检查。）
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  ICONS,
  type IconName,
  iconPath,
} from '../src/renderer/src/components/ui/icons'

describe('图标表', () => {
  it('icons.ts 与生成脚本一致', () => {
    expect(() =>
      execFileSync('node', ['scripts/gen-icons.mjs', '--check'], {
        stdio: 'pipe',
      })
    ).not.toThrow()
  })

  it('每个图标都有默认字重的路径，选中态缺 fill 时退回默认字重', () => {
    for (const name of Object.keys(ICONS) as IconName[])
      expect(iconPath(name), name).toMatch(/^M/)
    expect(iconPath('heart', 'fill')).not.toBe(iconPath('heart'))
    expect(iconPath('close', 'fill')).toBe(iconPath('close'))
  })
})
