import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const tokens = readFileSync(
  join(__dirname, '../src/renderer/src/assets/styles/tokens.css'),
  'utf8'
)

/** 取某个选择器第一个块里声明的自定义属性名（块内没有嵌套花括号） */
function declared(selector: string): Set<string> {
  const start = tokens.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const body = tokens.slice(start, tokens.indexOf('\n}', start))
  return new Set(
    body.match(/^\s*(--[\w-]+):/gm)?.map(line => line.trim().slice(0, -1))
  )
}

describe('主题令牌', () => {
  it('浅色块覆盖的令牌在 :root（深色默认）里都有定义', () => {
    const root = declared(':root')
    const missing = [...declared("[data-theme='light']")].filter(
      name => !root.has(name)
    )
    // 只在浅色里定义的令牌在深色下是未定义，calc(... + var(--x)) 整条失效（首页 Hero 文案曾因此跑到顶上）
    expect(missing).toEqual([])
  })
})
