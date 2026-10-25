/**
 * 页面跳转与设置技能包：打开应用里的页面、打开设置面板的某个分区。普通与私密模式都生效。
 *
 * 可去的页面来自路由表：有标题、路径不带参数、并且没有标记为私密的路由（{@link AssistantPage}）。
 * 私密分区不在清单里，模型给出清单外的页面一律降级为只回答文字。
 */
import {
  type AssistantSkill,
  type SkillAction,
  closeOutcome,
  defineAction,
} from './skill-types'

/** 一个可以跳转的页面 */
export interface AssistantPage {
  /** 给模型的 id（路径去掉斜杠，首页为 online） */
  id: string
  path: string
  label: string
}

/** 路由表里的一条（只用到这些字段） */
export interface RouteLike {
  path: string
  meta?: Record<string | number | symbol, unknown>
}

/** 是否标记为私密路由（开关打开才有的分区） */
export function isPrivateRoute(route: RouteLike): boolean {
  return route.meta?.adultOnly === true
}

/** 路由表 → 可以跳转的页面 */
export function assistantPages(routes: readonly RouteLike[]): AssistantPage[] {
  return routes
    .filter(
      route =>
        typeof route.meta?.title === 'string' &&
        route.path.startsWith('/') &&
        !route.path.includes(':') &&
        !isPrivateRoute(route)
    )
    .map(route => ({
      id: route.path === '/' ? 'online' : route.path.slice(1),
      path: route.path,
      label: String(route.meta?.title),
    }))
}

/** 可以打开的设置分区 */
export const ASSISTANT_SETTINGS: Record<string, string> = {
  appearance: '外观',
  images: '图片质量',
  scrape: '刮削',
  provider: '服务',
  sources: '数据源',
  player: '播放器',
  danmaku: '弹幕',
  ai: 'AI',
  assistant: 'AI 助手',
  update: '软件更新',
}

const has = (table: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key)

/** 新建页面跳转与设置技能包 */
export function createNavigationSkill(
  pages: readonly AssistantPage[]
): AssistantSkill {
  const byId = new Map(pages.map(page => [page.id, page]))
  const list = pages.map(page => `${page.id}=${page.label}`).join('、')
  const sections = Object.entries(ASSISTANT_SETTINGS)
    .map(([id, label]) => `${id}=${label}`)
    .join('、')

  const navigate: SkillAction = defineAction<AssistantPage>({
    name: 'navigate',
    describe: `打开页面；target 取 ${list}。`,
    parse: raw => byId.get(raw.target) ?? null,
    async run(page, env) {
      await env.router.push(page.path)
      return closeOutcome
    },
  })

  const settings = defineAction<string>({
    name: 'settings',
    describe: `打开设置；target 取 ${sections}。`,
    parse: raw => (has(ASSISTANT_SETTINGS, raw.target) ? raw.target : null),
    async run(section, env) {
      env.openSettings(section)
      return closeOutcome
    },
  })

  return {
    id: 'navigation',
    scope: 'any',
    actions: [navigate, settings],
    suggestions: context => (context.playing ? [] : ['打开 AI 设置']),
  }
}
