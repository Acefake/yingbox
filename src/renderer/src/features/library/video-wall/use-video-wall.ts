/**
 * 视频墙的运行：把调度器（wall-schedule）、每格的播放（wall-tile）和窗口状态接起来。
 *
 * - 开场：停掉悬停预览，按影片数与窗口尺寸定 2×2 / 3×3（之后不随窗口变），请求全屏；
 * - 每格的媒体复用海报墙悬停预览的来源（wallPreviewSource → 片库 getPreview）：
 *   本地文件从 10% 起播 6 秒，网盘 / 网络路径只轮播缓存图；同一部只取一次；
 * - 能否播放 = 窗口可见 && 没按空格暂停 && 没开「减少动态效果」；后者只显示海报，不取预览；
 * - 只有缓存图的条目与解码失败的影片标为只放图，不占播放名额；
 * - 吃力降级：任一格报告卡顿 / 掉帧就少一个播放名额，5 秒内只降一次（几格同时卡只算一次）；
 * - 同时播放上限存在设置 ui.videoWallMaxLive（经主进程写入，多窗口同步）；
 * - 键盘：数字键选格、方向键移动、空格暂停全部、回车打开选中格；Esc 走全局层栈；
 *   全屏被系统退出（F11、浏览器自己的 Esc）也关闭；
 * - 卸载：每格释放（清 src + load()）、中止在取的预览、退出全屏、摘掉监听。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'

import type { LibraryItemSummary } from '../../../../../shared/library/ipc'
import {
  type PreviewMedia,
  stopHoverPreview,
} from '@/components/ui/hover-preview'
import { toast } from '@/components/ui/toast'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { getSetting, setSetting } from '@/features/settings'
import { isComposing } from '@/utils/keyboard'

import { libraryBridge } from '../api/bridge'
import { play, primaryPlayRequest } from '../detail/playback'
import { itemImage } from '../api/images'
import { wallPreviewSource } from '../wall/wall-preview'
import {
  DEFAULT_MAX_LIVE,
  WALL_LIVE_CHOICES,
  canPlay,
  createWallSchedule,
  wallColumns,
} from './wall-schedule'
import { type WallTile, createWallTile } from './wall-tile'

/** 两次降级的最短间隔 */
const DEGRADE_GAP_MS = 5000

/** 设置里的同时播放上限（不在可选档位里时用默认 4） */
function savedMaxLive(): number {
  const saved = getSetting('ui.videoWallMaxLive')
  return (WALL_LIVE_CHOICES as readonly number[]).includes(saved)
    ? saved
    : DEFAULT_MAX_LIVE
}

/** useVideoWall 的输入。 */
export interface VideoWallOptions {
  items: LibraryItemSummary[]
  root: Ref<HTMLElement | null>
  onClose: () => void
  onOpen: (itemId: number) => void
}

/** 视频墙的状态与操作（给 VideoWall.vue 用）。 */
export interface VideoWallState {
  /** 列数（= 行数） */
  columns: number
  /** 每格当前的影片 */
  cells: ComputedRef<
    Array<{ id: number; title: string; poster: string | null }>
  >
  /** 选中格（键盘选过之前为 -1） */
  selected: Ref<number>
  /** 用户按空格暂停 */
  paused: Ref<boolean>
  /** 同时播放上限（分段控件的值） */
  maxLive: Ref<string>
  liveOptions: Array<{ value: string; label: string }>
  /** 模板 :ref 回调：登记第 slot 格的媒体层 */
  setHost(slot: number, el: unknown): void
  togglePause(): void
  /** 播放这部：取条目详情交给现有播放入口，视频墙先暂停 */
  playItem(itemId: number): Promise<void>
}

/** 新建视频墙的运行状态。 */
export function useVideoWall(options: VideoWallOptions): VideoWallState {
  const byId = new Map(options.items.map(item => [item.id, item]))
  const columns = wallColumns(options.items.length, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  const initialMax = savedMaxLive()
  const schedule = createWallSchedule(
    options.items.map(item => item.id),
    columns * columns,
    initialMax
  )
  const reducedMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  ).matches
  const hidden = ref(document.hidden)
  const paused = ref(false)
  const playing = computed(() =>
    canPlay({ hidden: hidden.value, paused: paused.value, reducedMotion })
  )
  /** 选中格；用过键盘选格之前为 -1（不显示选中框，免得开场就压着一格） */
  const selected = ref(-1)
  const maxLive = ref(String(initialMax))
  /** 格子内容版本（换片后让模板重读 itemAt） */
  const version = shallowRef(0)

  const hosts: Array<HTMLElement | null> = []
  const tiles: WallTile[] = []
  const shownLive: boolean[] = []
  const aborts: Array<AbortController | undefined> = []
  const media = new Map<number, Promise<PreviewMedia | null>>()
  let lastDegrade = -Infinity

  const cells = computed(() => {
    void version.value
    return Array.from({ length: schedule.cells }, (_, slot) => {
      const item = byId.get(schedule.itemAt(slot))!
      return {
        id: item.id,
        title: item.title,
        poster: itemImage(item.poster, 780),
      }
    })
  })

  function mediaOf(
    itemId: number,
    signal: AbortSignal
  ): Promise<PreviewMedia | null> {
    let pending = media.get(itemId)
    if (!pending) {
      pending = wallPreviewSource(byId.get(itemId)!)
        .resolve(signal)
        .catch(() => null)
      media.set(itemId, pending)
    }
    return pending
  }

  /** 给第 slot 格放它当前的影片（按是否占播放名额）。 */
  async function load(slot: number): Promise<void> {
    const tile = tiles[slot]
    if (!tile || reducedMotion) return
    aborts[slot]?.abort()
    const abort = new AbortController()
    aborts[slot] = abort
    const itemId = schedule.itemAt(slot)
    shownLive[slot] = schedule.isLive(slot)
    const found = await mediaOf(itemId, abort.signal)
    if (abort.signal.aborted) return
    // 没有视频（网盘只给缓存图 / 什么都没有）的不占播放名额，名额让给后面的格
    const needsDecoder = found?.kind === 'video'
    if (!needsDecoder) schedule.markStatic(itemId)
    const live = needsDecoder && schedule.isLive(slot)
    shownLive[slot] = live
    if (!playing.value) tile.pause()
    tile.show(found, live)
    if (!needsDecoder) refreshLive()
  }

  /** 播放名额变了：只重放占用状态变了的格。 */
  function refreshLive(): void {
    for (let slot = 0; slot < tiles.length; slot++)
      if (schedule.isLive(slot) !== shownLive[slot]) void load(slot)
  }

  function makeTile(slot: number, host: HTMLElement): WallTile {
    return createWallTile(host, {
      onDone: () => {
        if (schedule.advance(slot) !== null) version.value++
        void load(slot)
      },
      onFailed: () => {
        schedule.markStatic(schedule.itemAt(slot))
        shownLive[slot] = false
        refreshLive()
      },
      onStrain: () => {
        const now = Date.now()
        if (now - lastDegrade < DEGRADE_GAP_MS) return
        lastDegrade = now
        schedule.degrade()
        refreshLive()
      },
    })
  }

  function select(slot: number): void {
    schedule.select(slot)
    selected.value = schedule.selected()
    refreshLive()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (isComposing(event) || event.ctrlKey || event.metaKey || event.altKey)
      return
    const n = schedule.cells
    const cur = schedule.selected()
    const moves: Record<string, number> = {
      ArrowLeft: cur - 1,
      ArrowRight: cur + 1,
      ArrowUp: cur - columns,
      ArrowDown: cur + columns,
    }
    if (/^[1-9]$/.test(event.key) && Number(event.key) <= n)
      select(Number(event.key) - 1)
    else if (event.key in moves) {
      const next = moves[event.key]
      if (next >= 0 && next < n) select(next)
    } else if (event.key === ' ') paused.value = !paused.value
    else if (event.key === 'Enter') options.onOpen(schedule.itemAt(cur))
    else return
    event.preventDefault()
  }

  /** 播放：取条目详情，交给 openMediaPlayer（播放弹窗 / mpv，桌面与网页同一入口）。 */
  async function playItem(itemId: number): Promise<void> {
    paused.value = true
    const node = await libraryBridge()?.getItem(itemId)
    const request = node ? primaryPlayRequest(node) : null
    const poster = itemImage(byId.get(itemId)?.poster ?? null, 780)
    if (!request || !(await play(request, poster ?? undefined)))
      toast.warning('当前环境无法播放本地文件')
  }

  // —— 窗口状态 ——
  const onVisibility = (): void => {
    hidden.value = document.hidden
  }
  let fullscreen = false
  const onFullscreen = (): void => {
    if (fullscreen && !document.fullscreenElement) options.onClose()
  }

  watch(playing, on => {
    for (const tile of tiles) {
      if (on) tile.resume()
      else tile.pause()
    }
  })
  watch(maxLive, value => {
    schedule.setMaxLive(Number(value))
    void setSetting('ui.videoWallMaxLive', Number(value)).catch(() => {})
    refreshLive()
  })
  useEscapeLayer(() => true, options.onClose)

  onMounted(() => {
    stopHoverPreview()
    window.addEventListener('keydown', onKeydown)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreen)
    void options.root.value
      ?.requestFullscreen?.()
      .then(() => {
        fullscreen = true
      })
      .catch(() => {})
    hosts.forEach((host, slot) => {
      if (host) tiles[slot] = makeTile(slot, host)
    })
    tiles.forEach((_, slot) => void load(slot))
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('fullscreenchange', onFullscreen)
    for (const abort of aborts) abort?.abort()
    for (const tile of tiles) tile.release()
    tiles.length = 0
    fullscreen = false
    if (document.fullscreenElement) void document.exitFullscreen()
  })

  return {
    columns,
    cells,
    selected,
    paused,
    maxLive,
    liveOptions: WALL_LIVE_CHOICES.map(n => ({
      value: String(n),
      label: String(n),
    })),
    setHost(slot: number, el: unknown): void {
      hosts[slot] = el instanceof HTMLElement ? el : null
    },
    togglePause: () => {
      paused.value = !paused.value
    },
    playItem,
  }
}
