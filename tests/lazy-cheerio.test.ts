// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
/**
 * cheerio 按需加载（src/shared/html/cheerio.ts）：
 * - 导入两个引擎的解析代码（媒体库核心 + 番号站点 / 演员来源、CatSpider 运行时）时不加载 cheerio；
 * - 第一次真正解析 HTML 才加载，之后复用，不再加载第二次；
 * - 源码里除了这一个模块，别处只能 `import type` cheerio（防止有人加回静态导入）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** 记录经 createRequire 加载的模块 id（cheerio.ts 用 createRequire 取 cheerio）。 */
const loads = vi.hoisted(() => [] as string[])
vi.mock('node:module', async importOriginal => {
  const actual = await importOriginal<typeof import('node:module')>()
  return {
    ...actual,
    createRequire: (path: string | URL) => {
      const req = actual.createRequire(path)
      return Object.assign((id: string) => {
        loads.push(id)
        return req(id) as unknown
      }, req)
    },
  }
})

const cheerioLoads = (): number => loads.filter(id => id === 'cheerio').length

describe('cheerio 按需加载', () => {
  it('导入两个引擎的解析代码不加载 cheerio，首次解析才加载且只加载一次', async () => {
    await import('../src/main/library/platform/platform')
    await import('../src/main/library/engine/rpc')
    await import('../src/main/library/providers/jav/actors')
    const { parseJavbusDetail } =
      await import('../src/main/library/providers/jav/sites/javbus')
    const { runCatSpider } = await import('../src/engine/online/catspider')
    await import('../src/engine/online')
    expect(cheerioLoads()).toBe(0)

    const page = '<html><head><title>x</title></head><body></body></html>'
    parseJavbusDetail(page, 'https://www.javbus.com/ABC-123')
    expect(cheerioLoads()).toBe(1)
    parseJavbusDetail(page, 'https://www.javbus.com/ABC-123')

    // CatSpider 插件拿到的是同一个 cheerio 模块（行为不变），也不会再加载一次
    const { createNetClient } = await import('../src/shared/net/client')
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async () => new Response('<ul><li>A</li><li>B</li></ul>'),
    })
    const plugin = `async function search() {
      const { data } = await $fetch.get('https://site.test/s')
      const $ = createCheerio().load(data)
      return jsonify({ list: $('li').toArray().map(li => $(li).text()),
        same: createCheerio() === createCheerio() })
    }`
    const result = await runCatSpider(
      { net, browserFetch: async () => '', loadPlugin: async () => plugin },
      'lazy.js',
      'search',
      {}
    )
    expect(result).toEqual({ list: ['A', 'B'], same: true })
    expect(cheerioLoads()).toBe(1)
  }, 30_000) // 首次导入媒体库核心的整张模块图，满载的分片里会超过默认 5 秒

  it('lazyModule：调用前不加载，加载一次后复用，加载失败下次重试', async () => {
    const { lazyModule } = await import('../src/shared/html/cheerio')
    const loader = vi.fn(() => ({ id: 1 }))
    const get = lazyModule(loader)
    expect(loader).not.toHaveBeenCalled()
    const first = get()
    expect(get()).toBe(first)
    expect(loader).toHaveBeenCalledTimes(1)

    let fail = true
    const flaky = lazyModule(() => {
      if (fail) throw new Error('boom')
      return 'ok'
    })
    expect(() => flaky()).toThrow('boom')
    fail = false
    expect(flaky()).toBe('ok')
  })

  it('load 与 cheerio 原生 load 结果相同', async () => {
    const { load, cheerio } = await import('../src/shared/html/cheerio')
    const html = '<div><a href="/x">链接</a></div>'
    expect(load(html)('a').attr('href')).toBe('/x')
    expect(load(html).html()).toBe(cheerio().load(html).html())
  })
})

const ROOT = join(__dirname, '..')
const LAZY = 'src/shared/html/cheerio.ts'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue|mts|js)$/.test(name) ? [path] : []
  })
}

describe('源码里没有 cheerio 的静态加载', () => {
  it('除 src/shared/html/cheerio.ts 外，只允许 import type cheerio', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .map(path => relative(ROOT, path).replaceAll('\\', '/'))
      .filter(path => path !== LAZY)
      .filter(path => {
        const src = readFileSync(join(ROOT, path), 'utf8')
        const valueImport =
          /^\s*import\s+(?!type\b)[^;]*?from\s+['"]cheerio['"]/m.test(src) ||
          /^\s*import\s+['"]cheerio['"]/m.test(src)
        const dynamic = /(require|import)\(\s*['"]cheerio['"]\s*\)/.test(src)
        return valueImport || dynamic
      })
    expect(offenders).toEqual([])
  })
})
