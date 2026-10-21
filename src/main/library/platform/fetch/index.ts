/**
 * 按配置选出网实现（独立服务用；桌面端固定用 Electron net.fetch）。
 *
 * 配置串（环境变量 YINGBOX_FETCH / 参数 --fetch）：
 * - 空或 `node`：Node fetch（undici），默认；
 * - `curl` / `curl:<可执行文件>`：经 curl 命令行，填 curl-impersonate 的包装脚本即可模仿浏览器指纹；
 * - `module:<文件路径>`：自定义模块，导出 `createFetch(): HttpFetch | Promise<HttpFetch>`（或 default 导出同名函数），
 *   用于接入其它实现，也用于离线冒烟（录制页面回放）。
 * 不管哪种实现，被 Cloudflare 拦下时都由番号源的按主机熔断跳过，不会反复请求。
 */
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HttpFetch } from '../../identify/identify-module'
import { createCurlFetch } from './curl-fetch'
import { createNodeFetch } from './node-fetch'

export { createCurlFetch, parseCurlOutput } from './curl-fetch'
export { createNodeFetch } from './node-fetch'

/** 解析后的配置。 */
export type FetchSpec =
  | { kind: 'node' }
  | { kind: 'curl'; binary?: string }
  | { kind: 'module'; path: string }

/** 解析配置串；不认识时抛错（启动时就失败，比运行中静默退回更好排查）。 */
export function parseFetchSpec(raw: string | undefined): FetchSpec {
  const spec = (raw ?? '').trim()
  if (!spec || spec === 'node' || spec === 'undici') return { kind: 'node' }
  if (spec === 'curl') return { kind: 'curl' }
  if (spec.startsWith('curl:')) return { kind: 'curl', binary: spec.slice(5) }
  if (spec.startsWith('module:') && spec.length > 7)
    return { kind: 'module', path: spec.slice(7) }
  throw new Error(
    `不支持的出网实现：${spec}（可选 node / curl[:路径] / module:路径）`
  )
}

/** 自定义模块的形状。 */
interface FetchModule {
  createFetch?: () => HttpFetch | Promise<HttpFetch>
  default?:
    | (() => HttpFetch | Promise<HttpFetch>)
    | { createFetch?: () => HttpFetch | Promise<HttpFetch> }
}

/** 按配置创建出网实现；cwd 用于解析相对的模块路径。 */
export async function createFetch(
  spec: FetchSpec,
  cwd = process.cwd()
): Promise<HttpFetch> {
  switch (spec.kind) {
    case 'node':
      return createNodeFetch()
    case 'curl':
      return createCurlFetch({ binary: spec.binary })
    case 'module': {
      const file = isAbsolute(spec.path) ? spec.path : resolve(cwd, spec.path)
      const mod = (await import(pathToFileURL(file).href)) as FetchModule
      const factory =
        mod.createFetch ??
        (typeof mod.default === 'function'
          ? mod.default
          : mod.default?.createFetch)
      if (typeof factory !== 'function')
        throw new Error(`${file} 没有导出 createFetch()`)
      return factory()
    }
  }
}

/** 实现的简短描述（启动日志用）。 */
export function describeFetch(spec: FetchSpec): string {
  if (spec.kind === 'curl') return `curl（${spec.binary || 'curl'}）`
  if (spec.kind === 'module') return `自定义模块 ${spec.path}`
  return 'Node fetch（undici）'
}
