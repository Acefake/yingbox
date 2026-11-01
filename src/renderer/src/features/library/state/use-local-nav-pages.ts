/**
 * 侧栏「本地媒体」里的普通片库页面：电影 / 剧集 / 动漫 / 综艺 / 纪录片一律有条目才显示；
 * 一个都没有时只留一个入口（还没加文件夹是「添加媒体库」，加了还在扫描是「媒体库」），
 * 打开片库页，空状态里就是「添加文件夹…」。番号页由侧栏按成人模式另加，不在这里。
 *
 * 模块级单例：每页查一次 limit=1 的总数；条目或媒体库变化后最多每 REFRESH_DELAY_MS 重查一次
 * （扫描、识别时事件很密，不必每条都查），网页端片库服务连上时也重查。
 */
import { type ComputedRef, computed, effectScope, ref, watch } from 'vue'

import type { IconName } from '@/components/ui/icons'
import { isWebRuntime, libraryServerState } from '@/services/library-server'

import { libraryBridge } from '../api/bridge'
import { subscribeLibraryEvents } from './library-events'
import { type LibrarySection, SECTIONS } from './library-section'
import { sectionQuery } from './query-state'

/** 普通片库的页面（侧栏顺序）。 */
export const LOCAL_SECTIONS = [
  'movie',
  'tv',
  'anime',
  'variety',
  'documentary',
] as const satisfies readonly LibrarySection[]

type LocalSection = (typeof LOCAL_SECTIONS)[number]

/** 侧栏里的一个本地媒体页面。 */
export interface LocalNavPage {
  label: string
  icon: IconName
  path: string
  /** 在这些路由上算选中（只剩一个入口时它代表全部片库页面）。 */
  routeNames: string[]
}

/** 片库现状：各页条目数（还没查回来是 null）与有没有普通片库文件夹。 */
export interface LocalNavState {
  counts: Readonly<Record<LocalSection, number>> | null
  hasLibraries: boolean
}

const pageOf = (section: LocalSection): LocalNavPage => {
  const { label, icon, path, routeName } = SECTIONS[section]
  return { label, icon, path, routeNames: [routeName] }
}

/**
 * 侧栏要显示的本地媒体页面。还没查回来时先照旧显示电影、剧集（有库的用户启动时入口不闪）。
 */
export function localNavPages(state: LocalNavState): LocalNavPage[] {
  if (!state.counts) return [pageOf('movie'), pageOf('tv')]
  const { counts } = state
  const filled = LOCAL_SECTIONS.filter(section => counts[section] > 0)
  if (filled.length) return filled.map(pageOf)
  return [
    {
      ...pageOf('movie'),
      label: state.hasLibraries ? '媒体库' : '添加媒体库',
      icon: 'folder',
      routeNames: LOCAL_SECTIONS.map(section => SECTIONS[section].routeName),
    },
  ]
}

/** 条目变化后多久重查。 */
const REFRESH_DELAY_MS = 2000

const navState = ref<LocalNavState>({ counts: null, hasLibraries: false })
let started = false
let timer: ReturnType<typeof setTimeout> | undefined
/** 只认最后一次发出的查询，先发后到的旧结果不覆盖新的。 */
let sequence = 0

/** 查不回来（引擎重启、网页端离线）时保留上一次的结果，不把有片库的用户当成「还没添加」。 */
async function refresh(): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge) return
  const current = ++sequence
  let libraries: Awaited<ReturnType<typeof bridge.listLibraries>>
  let totals: number[]
  try {
    ;[libraries, totals] = await Promise.all([
      bridge.listLibraries(),
      Promise.all(
        LOCAL_SECTIONS.map(section =>
          bridge
            .query({ ...sectionQuery(section), limit: 1 })
            .then(result => result.total)
        )
      ),
    ])
  } catch {
    return
  }
  if (current !== sequence) return
  navState.value = {
    counts: Object.fromEntries(
      LOCAL_SECTIONS.map((section, i) => [section, totals[i]])
    ) as Record<LocalSection, number>,
    hasLibraries: libraries.some(lib => lib.source !== 'jav'),
  }
}

function scheduleRefresh(): void {
  if (timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    void refresh()
  }, REFRESH_DELAY_MS)
}

function startOnce(): void {
  if (started || !libraryBridge()) return
  started = true
  subscribeLibraryEvents(event => {
    if (event.type === 'items-changed' || event.type === 'libraries-changed')
      scheduleRefresh()
  })
  // 网页端：片库服务连上（含登录后）时重查，离线时查不回来的那次不会自己重试。
  // 放在独立作用域里：单例不随第一个调用它的组件卸载而停
  if (isWebRuntime())
    effectScope(true).run(() =>
      watch(libraryServerState(), state => {
        if (state === 'online') scheduleRefresh()
      })
    )
  void refresh()
}

/** 侧栏「本地媒体」里的普通片库页面（按侧栏顺序）。 */
export function useLocalNavPages(): ComputedRef<LocalNavPage[]> {
  startOnce()
  return computed(() => localNavPages(navState.value))
}
