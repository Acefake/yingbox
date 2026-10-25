/**
 * 内置技能包的登记：媒体库、播放器、页面跳转与设置。助手浮层第一次打开时调用（浮层按需加载，
 * 这些技能用到的媒体库 / 推荐模块也就跟着按需加载，不进主包）。重复调用只替换同 id 的技能。
 */
import { createLibrarySkill } from './library-skill'
import {
  type RouteLike,
  assistantPages,
  createNavigationSkill,
  isPrivateRoute,
} from './navigation-skill'
import { playerSkill } from './player-skill'
import type { SkillRegistry } from './skill-registry'

/** 私密路由对应的板块名（路径去掉斜杠），「继续播放」记录按它排除 */
export function privateSections(routes: readonly RouteLike[]): Set<string> {
  return new Set(
    routes.filter(isPrivateRoute).map(route => route.path.replace(/^\//, ''))
  )
}

/**
 * 登记内置技能包。
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
