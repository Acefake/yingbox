/**
 * ADR（docs/adr/）：每篇有状态与 背景 / 决策 / 后果 / 否决方案 四节，编号连续不重复，
 * AGENTS.md 的「Decisions (ADR)」索引列出每一篇。改变已定决策须新增 ADR。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIR = 'docs/adr'
const files = readdirSync(DIR)
  .filter(name => name.endsWith('.md'))
  .sort()

describe('ADR', () => {
  it('文件名为 四位编号-英文短名.md，编号从 0001 连续', () => {
    expect(files.length).toBeGreaterThan(0)
    files.forEach((name, i) => {
      expect(name).toMatch(/^\d{4}-[a-z0-9-]+\.md$/)
      expect(name.slice(0, 4)).toBe(String(i + 1).padStart(4, '0'))
    })
  })

  it.each(files)('%s 有标题、状态和四节', name => {
    const text = readFileSync(`${DIR}/${name}`, 'utf8')
    expect(text).toMatch(new RegExp(`^# ADR-${name.slice(0, 4)} \\S`))
    expect(text).toMatch(/^- 状态：(?:已采纳|已废弃|已被 ADR-\d{4} 取代)/m)
    for (const section of ['背景', '决策', '后果', '否决方案'])
      expect(text, `${name} 缺「${section}」`).toMatch(
        new RegExp(`^## ${section}$`, 'm')
      )
  })

  it('AGENTS.md 索引列出每一篇，并写明改变决策须新增 ADR', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')
    expect(agents).toContain('requires a new ADR')
    for (const name of files) expect(agents).toContain(`(${DIR}/${name})`)
  })
})
