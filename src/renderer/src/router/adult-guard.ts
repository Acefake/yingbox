/**
 * 成人页面的路由守卫规则（纯函数，便于单测）：路由 meta.adultOnly 为真的页面（番号库 /jav、AV /av）
 * 只在成人模式开启时可进入；关闭时回首页。
 */

/** 守卫需要的路由信息（vue-router 的 RouteLocation 的子集）。 */
export interface GuardTarget {
  meta?: { adultOnly?: unknown }
}

/** 要重定向时返回目标路径；可以进入返回 null。 */
export function adultRedirect(
  to: GuardTarget,
  adultMode: boolean
): string | null {
  return to.meta?.adultOnly && !adultMode ? '/' : null
}
