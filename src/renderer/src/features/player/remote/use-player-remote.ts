/**
 * PlayerSession 用的遥控登记：每换一个 Artplayer 实例重新 attach，组件卸载时撤下。
 */
import type Artplayer from 'artplayer'
import { type Ref, onBeforeUnmount, watch } from 'vue'

import { type PlayerRemoteTarget, attachPlayerRemote } from './player-remote'

/** 登记参数：除实例外的部分 */
export type PlayerRemoteOptions = Omit<PlayerRemoteTarget, 'art'>

/**
 * 跟随 art 登记 / 撤下遥控目标。
 * @param art 当前 Artplayer 实例（换集时会变）
 * @param options 每次登记时取：片名、跳过片头 key、是否私密
 */
export function usePlayerRemote(
  art: Ref<Artplayer | null | undefined>,
  options: () => PlayerRemoteOptions
): void {
  let detach: (() => void) | null = null
  watch(art, instance => {
    detach?.()
    detach = instance
      ? attachPlayerRemote({ art: instance, ...options() })
      : null
  })
  onBeforeUnmount(() => detach?.())
}
