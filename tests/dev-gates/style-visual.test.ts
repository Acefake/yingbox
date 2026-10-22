// test-affected: repo-wide（扫描渲染层全部样式）
/**
 * 视觉令牌纪律（scripts/style-visual.mjs，由 check:style 调用）与「只减不增」基线（scripts/ratchet.mjs）。
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  compareCounts,
  countFindings,
  describeRatchet,
} from '../../scripts/ratchet.mjs'
import { visualFindings } from '../../scripts/style-visual.mjs'

const rules = (css: string): string[] =>
  visualFindings(css, { file: 'a.vue' }).map(f => f.rule)

describe('视觉纪律', () => {
  it('字重只允许 400 / 500 / 600 及对应令牌', () => {
    expect(
      rules(`.a { font-weight: 400 } .b { font-weight: var(--font-weight-medium) }
             .c { font-weight: 600 } .d { font-weight: normal } .e { font-weight: inherit }`)
    ).toEqual([])
    expect(
      rules(`.a { font-weight: 700 } .b { font-weight: bold }
             .c { font-weight: var(--font-weight-bold) } .d { font-weight: 300 }`)
    ).toEqual(['font-weight', 'font-weight', 'font-weight', 'font-weight'])
  })

  it('圆角只允许 --radius-* 令牌、0、50%', () => {
    expect(
      rules(`.a { border-radius: var(--radius-lg) } .b { border-radius: 50% }
             .c { border-radius: 0 } .d { border-radius: var(--radius-md) var(--radius-md) 0 0 }
             .e { border-top-left-radius: var(--radius-sm) }
             .f { border-radius: var(--radius-lg, var(--radius-xl)) }`)
    ).toEqual([])
    expect(
      rules(`.a { border-radius: 10px } .b { border-radius: 30% }
             .c { border-radius: calc(var(--radius-lg) - 2px) } .d { border-bottom-right-radius: 3px }`)
    ).toEqual(['radius', 'radius', 'radius', 'radius'])
  })

  it('颜色只用令牌：#hex、颜色函数、颜色属性里的命名颜色都算违规', () => {
    expect(
      rules(`.a { color: var(--text-primary); background: transparent }
             .b { border: 1px solid currentColor } .c { font-family: Black Han Sans }
             .d { background: color-mix(in srgb, var(--accent) 20%, transparent) }`)
    ).toEqual([])
    expect(
      rules(`.a { color: #fff } .b { background: rgba(0, 0, 0, 0.5) }
             .c { border-color: white } .d { box-shadow: 0 0 2px hsl(0 0% 0%) }
             .e { --local-bg: #121214 } .f { background: linear-gradient(black, transparent) }`)
    ).toEqual(['color', 'color', 'color', 'color', 'color', 'color'])
  })

  it('选中态只换填充，不加边框或描边；焦点样式与「去掉边框」不算', () => {
    expect(
      rules(`.item.active { background: var(--bg-active) }
             .item.active:focus-visible { outline: 2px solid var(--accent) }
             .tab[aria-selected='true'] { border-color: transparent }
             .tab[aria-selected='false'] { border: 1px solid var(--border-default) }
             .item:active { border: 1px solid var(--border-default) }`)
    ).toEqual([])
    expect(
      rules(`.item.active { border: 1px solid var(--accent) }
             .row[aria-current='page'] { outline: 1px solid var(--accent) }
             .chip.is-selected { border-color: var(--accent) }
             input:checked + .box { border-width: 2px }
             .card { &.selected { border: 1px solid var(--accent) } }
             .tab.active { .label { border-bottom: 2px solid var(--accent) } }`)
    ).toEqual([
      'selected-border',
      'selected-border',
      'selected-border',
      'selected-border',
      'selected-border',
      'selected-border',
    ])
  })

  it('行号含 <style> 块之前的偏移；同一行写 style-tokens: visual 豁免', () => {
    const found = visualFindings('.a {\n  color: #fff;\n}', {
      file: 'a.vue',
      lineOffset: 10,
    })
    expect(found).toEqual([
      { file: 'a.vue', line: 12, rule: 'color', text: 'color: #fff' },
    ])
    expect(
      rules(
        '.a { color: #fff; /* style-tokens: visual（海报上的固定白字） */ }'
      )
    ).toEqual([])
  })
})

describe('只减不增基线', () => {
  const counts = countFindings([
    { file: 'b.vue', rule: 'color' },
    { file: 'a.vue', rule: 'radius' },
    { file: 'b.vue', rule: 'color' },
  ])

  it('按文件、规则计数，键有序', () => {
    expect(counts).toEqual({ 'a.vue': { radius: 1 }, 'b.vue': { color: 2 } })
    expect(Object.keys(counts)).toEqual(['a.vue', 'b.vue'])
  })

  it('新增违规算 grown，修掉了没收紧基线算 stale，两者都要报', () => {
    const result = compareCounts(
      { 'a.vue': { radius: 2 }, 'b.vue': { color: 1 } },
      counts
    )
    expect(result.grown).toEqual([
      { file: 'b.vue', rule: 'color', baseline: 1, current: 2 },
    ])
    expect(result.stale).toEqual([
      { file: 'a.vue', rule: 'radius', baseline: 2, current: 1 },
    ])
    expect(describeRatchet(result, 'cmd').join('\n')).toMatch(
      /b\.vue: color 2 处，基线 1 处[\s\S]*cmd/
    )
    expect(describeRatchet(compareCounts(counts, counts), 'cmd')).toEqual([])
  })

  it('当前仓库通过 check:style（含视觉纪律基线）', () => {
    expect(() =>
      execFileSync('node', ['scripts/style-tokens.mjs'], { encoding: 'utf8' })
    ).not.toThrow()
  })
})
