// test-affected: repo-wide
/**
 * AI 助手核心与私密技能的隔离（读源码）：助手核心目录、主进程助手与共享契约里（含注释）没有敏感词；
 * 私密技能包只经应用入口的动态 import 加载，核心不直接引用它；打包检查脚本的判定规则。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SENSITIVE } from './assistant-fixtures'
import { checkChunks } from '../scripts/check-assistant-chunks.mjs'

const ROOT = join(__dirname, '..')

/** 递归列出目录下的源文件 */
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.(ts|vue|css)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  )
}

const CORE = [
  ...sources('src/renderer/src/features/assistant'),
  ...sources('src/main/assistant'),
  'src/shared/assistant.ts',
  'src/shared/contract/assistant.ts',
]

describe('助手核心不含敏感词', () => {
  it.each(CORE)('%s', file => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const hit = SENSITIVE.exec(text)
    expect(hit?.[0] ?? null).toBeNull()
  })

  it('私密技能包只由应用入口动态 import，核心不引用它', () => {
    for (const file of CORE)
      expect(readFileSync(join(ROOT, file), 'utf8')).not.toContain(
        'features/av'
      )
    const main = readFileSync(join(ROOT, 'src/renderer/src/main.ts'), 'utf8')
    expect(main).toContain("load: () => import('@/features/av/assistant')")
    expect(main).not.toMatch(/^import .*features\/av\/assistant/m)
  })
})

describe('打包隔离检查的判定', () => {
  const core = { name: 'AssistantOverlay-1.js', code: '"问影盒…"' }
  const secret = { name: 'index-2.js', code: '"问私密库…"' }
  const entry = { name: 'index-0.js', code: 'routes' }

  it('核心干净、私密技能独立成 chunk 时通过', () => {
    expect(checkChunks([entry, core, secret], 'index-0.js')).toEqual([])
  })

  it('核心含敏感词、私密技能并进入口或核心时报错', () => {
    expect(
      checkChunks(
        [entry, { ...core, code: '"问影盒…番号"' }, secret],
        'index-0.js'
      )
    ).toEqual([expect.stringContaining('番号')])
    expect(
      checkChunks([{ ...entry, code: '"问私密库…"' }, core], 'index-0.js')
    ).toEqual([expect.stringContaining('入口')])
    expect(
      checkChunks(
        [entry, { ...core, code: '"问影盒" "问私密库"' }],
        'index-0.js'
      ).length
    ).toBeGreaterThan(0)
  })
})
