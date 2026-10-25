// test-affected: repo-wide（子进程跑 scripts/gen-icons.mjs 比对生成物，vitest 依赖图看不到这层依赖）
/**
 * 图标表：icons.ts 由 scripts/gen-icons.mjs 从 Phosphor 生成，手改或改了表没重新生成都会失败；
 * 每个图标都有默认字重的路径。（模板里的图标名由 vue-tsc 按 IconName 检查。）
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  ICONS,
  type IconName,
  iconPath,
} from '../src/renderer/src/components/ui/icons'

/** 仓库根：由测试文件位置推导，不依赖 vitest 的工作目录 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('图标表', () => {
  it('icons.ts 与生成脚本一致', () => {
    expect(() =>
      execFileSync('node', ['scripts/gen-icons.mjs', '--check'], {
        cwd: ROOT,
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
