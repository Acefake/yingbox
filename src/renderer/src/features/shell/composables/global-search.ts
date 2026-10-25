/**
 * 顶部全局搜索的纯规则：聚焦快捷键、各页面的占位文字，以及提交 / 清空后应跳到哪里。
 * 本地片库页（电影、剧集、番号）在本页按 ?q= 过滤；AV 页和其余页面跳到对应的搜索标签。
 */

/** 在本页用 ?q= 过滤的路由 */
const LOCAL_FILTER_ROUTES = new Set(['Movie', 'TV', 'Jav'])

/** 是否在本页按 ?q= 过滤（本地片库页）：这些页边输入边过滤，不用回车 */
export function filtersInPlace(routeName: string | undefined): boolean {
  return Boolean(routeName && LOCAL_FILTER_ROUTES.has(routeName))
}

const PLACEHOLDERS: Record<string, string> = {
  Movie: '搜索本地电影',
  TV: '搜索本地电视剧',
  Jav: '搜索本地番号',
  AV: '搜索 AV 资源',
}

/** 聚焦搜索框的快捷键文字（Cmd/Ctrl+K 归 AI 助手，见 features/assistant/assistant-hotkey） */
const SEARCH_SHORTCUT_LABEL = 'Ctrl + F'

/** isSearchShortcut 用到的按键字段 */
export interface SearchShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
  target?: EventTarget | null
}

/**
 * 聚焦顶部搜索框：Cmd+F（macOS）或 Ctrl+F，不带 Shift / Alt，输入法组字中不算。
 * 焦点在对话框里（播放弹窗、AI 助手、确认框）时不抢：顶部搜索框被它们盖着，抢走焦点后播放器快捷键也会失效。
 */
export function isSearchShortcut(event: SearchShortcutEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey)
    return false
  if (event.isComposing || event.key.toLowerCase() !== 'f') return false
  const target = event.target as { closest?: (s: string) => unknown } | null
  return !target?.closest?.('[role="dialog"]')
}

/** 搜索框占位文字；桌面端带快捷键提示 */
export function searchPlaceholder(
  routeName: string | undefined,
  isPhone: boolean
): string {
  const base =
    (routeName && PLACEHOLDERS[routeName]) ||
    (isPhone ? '搜索' : '搜索电影、电视剧')
  return isPhone ? base : `${base}（${SEARCH_SHORTCUT_LABEL}）`
}

/** 路由跳转目标（交给 router.replace） */
export interface SearchLocation {
  path: string
  query: Record<string, string>
}

/**
 * 计算提交或清空搜索后要去的地址。
 * @param routeName 当前路由名
 * @param routePath 当前路由路径
 * @param query 去掉首尾空白的搜索词；空串表示清空
 */
export function searchLocation(
  routeName: string | undefined,
  routePath: string,
  query: string
): SearchLocation {
  if (filtersInPlace(routeName)) {
    return { path: routePath, query: query ? { q: query } : {} }
  }
  return {
    path: routeName === 'AV' ? '/av' : '/',
    query: query ? { tab: 'search', q: query } : { tab: 'search' },
  }
}

/** 输入这个口令并回车会切换成人模式（不触发搜索） */
export const ADULT_MODE_PASSPHRASE = 'getav'
