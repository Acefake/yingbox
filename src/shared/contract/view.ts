import type { HomeView } from '../view/home'
import { call, defineDomain } from './define'

/**
 * 视图域（ADR-0030）：服务端用共享规则拼好页面数据，给安卓原生端用。
 * 只在 src/server 实现，不进桌面 IPC 契约表；桌面与网页直接用同一份共享规则。
 * 结果类型在 src/shared/view，Kotlin 由 scripts/gen-view-kotlin.ts 生成。
 */
export const view = defineDomain('view', {
  /** 首页：热门货架、榜单、按类型浏览、精选片单。服务端缓存 10 分钟；某行取不到就省略这一行。 */
  home: call<HomeView>(),
})
