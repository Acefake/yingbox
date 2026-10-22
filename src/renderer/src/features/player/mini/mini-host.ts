/**
 * 小窗的宿主接线：详情所在的页面声明自己是宿主，里面的页内播放器登记为「可进小窗」。
 *
 * - 切走路由（含 keep-alive 缓存）：宿主在 onBeforeRouteLeave 里让播放器进小窗，这时 <video> 还在文档里；
 * - 关闭详情：页面在关闭的那一刻（卸载之前）调 leave()；
 * - 详情重新显示（keep-alive 激活）：播放器认领回小窗里自己的会话；
 * - 详情卸载后重新打开：新播放器挂载时按地址认领（见各播放器）。
 *
 * 宿主之外的播放器（独立播放窗口）不登记，永远不进小窗。
 */
import {
  type InjectionKey,
  inject,
  onActivated,
  onBeforeUnmount,
  provide,
} from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

/** 宿主里一个可进小窗的播放器 */
export interface Dockable {
  /** 播放中就把自己交给小窗；返回是否交出 */
  dock: () => boolean
  /** 详情重新显示：认领回小窗里自己的会话（没有就什么都不做） */
  reclaim: () => void
}

/** 播放器从宿主拿到的东西 */
export interface MiniHostLink {
  /** 进小窗那一刻调用：生成「回到详情」 */
  restoreFn: () => () => void
}

interface HostContext extends MiniHostLink {
  register: (player: Dockable) => () => void
}

const HOST_KEY: InjectionKey<HostContext> = Symbol('mini-host')

/** provideMiniHost 的选项 */
export interface MiniHostOptions {
  /**
   * 进小窗那一刻调用，返回「导航回原路由之后还要做的事」（例如重新打开这个条目、重新显示播放层）。
   * 导航回进小窗时的路由由宿主负责。
   */
  capture?: () => (() => void) | undefined
}

/** provideMiniHost 的返回值 */
export interface MiniHost {
  /** 关闭详情：让播放中的播放器进小窗（在卸载之前同步调用） */
  leave: () => void
}

/** 声明当前组件（详情所在页面）是小窗宿主 */
export function provideMiniHost(options: MiniHostOptions = {}): MiniHost {
  const router = useRouter()
  const route = useRoute()
  const players = new Set<Dockable>()

  const restoreFn = (): (() => void) => {
    const path = route.fullPath
    const reopen = options.capture?.()
    return () => {
      void router.push(path).then(() => reopen?.())
    }
  }
  provide(HOST_KEY, {
    restoreFn,
    register: player => {
      players.add(player)
      return () => players.delete(player)
    },
  })

  const leave = (): void => {
    for (const player of players) player.dock()
  }
  onBeforeRouteLeave(() => {
    leave()
  })
  onActivated(() => {
    for (const player of players) player.reclaim()
  })
  return { leave }
}

/** 播放器：登记到最近的宿主；不在宿主里返回 null（不进小窗） */
export function useMiniHost(player: Dockable): MiniHostLink | null {
  const host = inject(HOST_KEY, null)
  if (!host) return null
  const unregister = host.register(player)
  onBeforeUnmount(unregister)
  return host
}
