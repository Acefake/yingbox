/**
 * cheerio 按需加载：两个 utilityProcess（后台引擎、媒体库引擎）启动时不再同步 require cheerio，
 * 第一次真正解析 HTML（CatSpider 插件、番号站点 / 演员来源的刮削）才加载，之后复用同一个模块。
 *
 * cheerio 约占引擎启动模块加载的 80%（≈300 ms、≈19 MB 私有内存），而很多会话根本用不到它。
 * 只在主进程侧（引擎 / 媒体库 / 独立服务）使用；源码里其它地方只允许 `import type` cheerio，
 * 由 tests/lazy-cheerio.test.ts 守住。
 */
import type * as Cheerio from 'cheerio'
import { createRequire } from 'node:module'

export type CheerioModule = typeof Cheerio

/** 包一个加载器：第一次调用才加载，之后返回同一个模块（加载失败不缓存，下次再试）。 */
export function lazyModule<T>(loader: () => T): () => T {
  let mod: T | undefined
  return () => (mod ??= loader())
}

/** 取 cheerio 模块（首次调用时加载）。 */
export const cheerio: () => CheerioModule = lazyModule(
  () => createRequire(__filename)('cheerio') as CheerioModule
)

/** 与 cheerio 的 `load` 相同，只是首次调用时才加载 cheerio。 */
export const load: CheerioModule['load'] = (...args) => cheerio().load(...args)
