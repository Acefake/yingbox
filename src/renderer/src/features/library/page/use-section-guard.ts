/**
 * 分区守卫：条目详情 / 演员详情的链接总是落在条目所属的页面上。
 *
 * - 演员只属于番号库：非番号页上的 ?actor= 换到 /jav（其余参数原样带过去）。
 * - ?item= 指向别的分区的条目时换到那个分区的页面：首页、继续播放只知道电影 / 剧集，
 *   动漫、综艺、纪录片由这里按条目类型换到对应页面；番号条目以前挂在电影页的旧链接同理。
 *   确认归属之前不渲染详情，番号条目不会在电影页上闪一下。
 *
 * 海报墙里已加载的条目（最常见的点击路径）直接放行，不额外请求；只有直接打开的链接才查一次条目。
 * 成人模式关闭时 /jav 由路由守卫挡回首页（router/index.ts），这里不重复判断。
 */
import { type ComputedRef, type Ref, computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { libraryBridge } from '../api/bridge'
import { type LibrarySection, SECTIONS, pageOf } from '../state/library-section'
import { findLibrary } from '../state/use-libraries'
import { onLibraryEvent } from '../state/library-events'

/** 条目归属：分区；missing = 条目不存在（交给详情页显示“找不到”）；unknown = 查不到归属。 */
export type ItemOwner = LibrarySection | 'missing' | 'unknown'

/** 查一个条目属于哪个分区。 */
export async function itemOwner(itemId: number): Promise<ItemOwner> {
  const bridge = libraryBridge()
  if (!bridge) return 'unknown'
  const item = await bridge.getItem(itemId).catch(() => null)
  if (!item) return 'missing'
  const lib =
    findLibrary(item.libraryId) ??
    (await bridge.listLibraries().catch(() => [])).find(
      l => l.id === item.libraryId
    )
  return lib ? pageOf(lib, item) : 'unknown'
}

/**
 * 归属确认后要做什么：留在本页显示详情（stay）、换到别的分区（move）、不显示（hide）。
 * 纯函数，便于单测。
 */
export function guardStep(
  section: LibrarySection,
  owner: ItemOwner
): { kind: 'stay' } | { kind: 'hide' } | { kind: 'move'; to: LibrarySection } {
  if (owner === section || owner === 'missing') return { kind: 'stay' }
  if (owner === 'unknown') return { kind: 'hide' }
  return { kind: 'move', to: owner }
}

/**
 * @param section 当前页面的分区
 * @param detailId 路由里的 ?item=
 * @param actorId 路由里的 ?actor=
 * @param inWall 条目是否已在本页海报墙里（已加载）
 * @returns detailReady：可以渲染条目详情了
 */
export function useSectionGuard(
  section: LibrarySection,
  detailId: Ref<number | null>,
  actorId: Ref<number | null>,
  inWall: (itemId: number) => boolean
): { detailReady: ComputedRef<boolean> } {
  const route = useRoute()
  const router = useRouter()
  const verified = ref<number | null>(null)
  let verifySequence = 0

  function moveTo(target: LibrarySection): void {
    // keep-alive 缓存的页面在后台也收到路由变化：只在本页是当前页时换页
    if (route.path !== SECTIONS[section].path) return
    void router.replace({ path: SECTIONS[target].path, query: route.query })
  }

  async function verify(id: number): Promise<void> {
    const sequence = ++verifySequence
    const step = guardStep(section, await itemOwner(id))
    if (detailId.value !== id || sequence !== verifySequence) return
    if (step.kind === 'stay') verified.value = id
    else if (step.kind === 'move') moveTo(step.to)
  }

  onLibraryEvent(event => {
    const id = detailId.value
    if (id === null || event.type !== 'items-changed') return
    if (event.reset || event.updated.includes(id) || event.removed.includes(id))
      void verify(id)
  })

  watch(
    actorId,
    id => {
      if (id !== null && section !== 'jav') moveTo('jav')
    },
    { immediate: true }
  )

  watch(
    detailId,
    async id => {
      if (id === null) {
        verifySequence++
        verified.value = null
        return
      }
      if (inWall(id)) {
        verifySequence++
        verified.value = id
        return
      }
      await verify(id)
    },
    { immediate: true }
  )

  return {
    detailReady: computed(
      () => detailId.value !== null && verified.value === detailId.value
    ),
  }
}
