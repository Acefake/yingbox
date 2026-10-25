import { type Ref, computed, shallowRef, watch } from 'vue'

import type { ActorSummary } from '../../../../../shared/library/ipc'
import { libraryBridge } from '../api/bridge'
import { itemImage } from '../api/images'
import { onLibraryEvent } from '../state/library-events'
import { type ActorLink, personKey } from './detail-rules'

/**
 * 番号库条目的演员链接：演员库里有记录的演员可点开详情，头像换成本地缓存的；
 * 后台查到资料（actors-changed）时重取。不是番号条目时为空表。
 *
 * @param itemId 番号条目的 id；不是番号条目时为 undefined
 * @returns 按 personKey(姓名) 索引的演员链接
 */
export function useActorLinks(
  itemId: Ref<number | undefined>
): Ref<ReadonlyMap<string, ActorLink>> {
  const bridge = libraryBridge()
  const links = shallowRef<ReadonlyMap<string, ActorLink>>(new Map())

  async function load(): Promise<void> {
    const id = itemId.value
    if (!id || !bridge?.actors) {
      links.value = new Map()
      return
    }
    const actors = await bridge.actors
      .forItem(id)
      .catch((): ActorSummary[] => [])
    if (id !== itemId.value) return
    links.value = new Map(
      actors.map((a): [string, ActorLink] => [
        personKey(a.name),
        { id: a.id, photo: itemImage(a.photo, 300) },
      ])
    )
  }

  watch(itemId, () => void load(), { immediate: true })
  onLibraryEvent(event => {
    if (event.type === 'actors-changed' && itemId.value) void load()
  })
  return computed(() => links.value)
}
