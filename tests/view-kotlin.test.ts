import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { KOTLIN_FILE, generateKotlin } from '../scripts/gen-view-kotlin'
import { s } from '../src/shared/view/schema'

describe('视图类型生成 Kotlin（ADR-0030）', () => {
  it('仓库里的 ViewModels.kt 与视图描述一致（不一致时运行 pnpm gen:view-kotlin）', () => {
    expect(readFileSync(KOTLIN_FILE, 'utf8')).toBe(generateKotlin())
  })

  it('可空、数组、嵌套数组、枚举和对象都生成对应的读法', () => {
    const Kind = s.enum('Kind', ['movie', 'tvShow'])
    const Inner = s.object('Inner', { n: s.number })
    const Outer = s.object('Outer', {
      name: s.nullable(s.string),
      kind: Kind,
      grid: s.array(s.array(s.boolean)),
      inner: s.nullable(Inner),
    })
    const kotlin = generateKotlin([Outer])

    expect(kotlin).toContain('val name: String?,')
    expect(kotlin).toContain('val grid: List<List<Boolean>>,')
    expect(kotlin).toContain(
      'name = (if (json.isNull("name")) null else json.getString("name")),'
    )
    expect(kotlin).toContain(
      'grid = json.getJSONArray("grid").let { a0 -> List(a0.length()) { i0 -> a0.getJSONArray(i0).let { a1 -> List(a1.length()) { i1 -> a1.getBoolean(i1) } } } },'
    )
    expect(kotlin).toContain('TV_SHOW("tvShow"),')
    expect(kotlin).toContain('kind = Kind.fromJson(json.getString("kind")),')
    expect(kotlin.indexOf('data class Outer')).toBeLessThan(
      kotlin.indexOf('data class Inner')
    )
  })

  it('同名但形状不同的类型直接报错', () => {
    const a = s.object('Same', { x: s.string })
    const b = s.object('Same', { y: s.string })
    expect(() => generateKotlin([s.object('Root', { a, b })])).toThrow('Same')
  })

  it('会生成编不过的 Kotlin 的描述直接报错', () => {
    expect(() =>
      generateKotlin(
        [s.enum('Clash', ['a-b', 'a_b'])].map(e => s.object('R', { e }))
      )
    ).toThrow('常量名冲突')
    expect(() => generateKotlin([s.object('R', { in: s.string })])).toThrow(
      'Kotlin 关键字'
    )
    expect(() =>
      generateKotlin([s.object('R', { x: s.nullable(s.nullable(s.string)) })])
    ).toThrow('可空套可空')
  })
})
