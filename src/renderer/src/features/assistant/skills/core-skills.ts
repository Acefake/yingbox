/**
 * 内置技能包的登记：媒体库、播放器、页面跳转与设置。助手浮层打开时调 {@link ensureCoreSkills}，
 * 只在第一次真正登记（浮层按需加载，这些技能用到的媒体库 / 推荐模块也就跟着按需加载，不进主包）。
 * 私密板块一律由路由表的 meta.adultOnly 推出（{@link privateRouteSections}），助手内外只有这一份名单。
 */
import { createLibrarySkill } from './library-skill'
import {
  type RouteLike,
  type RouteTable,
  assistantPages,
  createNavigationSkill,
  isPrivateRoute,
  resolvedRoutes,
} from './navigation-skill'
import { playerSkill } from './player-skill'
import type { SkillRegistry } from './skill-registry'

/** 私密路由对应的板块名（路径去掉斜杠），「继续播放」记录按它排除 */
export function privateSections(routes: readonly RouteLike[]): Set<string> {
  return new Set(
    routes.filter(isPrivateRoute).map(route => route.path.replace(/^\//, ''))
  )
}

/** 路由器上的私密板块（合并父路由 meta 之后），私密技能的「继续播放」也用它 */
export function privateRouteSections(router: RouteTable): Set<string> {
  return privateSections(resolvedRoutes(router))
}

/** 内置技能包的 id（登记过就不再重复登记） */
const CORE_SKILL_IDS = ['library', 'player', 'navigation'] as const

/**
 * 内置技能包还没登记时登记一次（每次打开浮层都会调）。
 * @param registry 注册表
 * @param router 路由器（取合并 meta 后的路由表）
 */
export function ensureCoreSkills(
  registry: SkillRegistry,
  router: RouteTable
): void {
  if (CORE_SKILL_IDS.every(id => registry.has(id))) return
  registerCoreSkills(registry, resolvedRoutes(router))
}

/**
 * 登记内置技能包（同 id 的替换掉）。
 * @param registry 注册表
 * @param routes 路由表（决定可跳转的页面与私密板块）
 */
export function registerCoreSkills(
  registry: SkillRegistry,
  routes: readonly RouteLike[]
): void {
  const hidden = privateSections(routes)
  registry.register(createLibrarySkill(section => hidden.has(section)))
  registry.register(playerSkill)
  registry.register(createNavigationSkill(assistantPages(routes)))
}
