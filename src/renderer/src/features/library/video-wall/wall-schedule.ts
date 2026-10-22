/**
 * 视频墙的格位调度（纯逻辑，不碰 DOM）。
 *
 * - 几列：影片不超过 4 部或窗口偏小用 2×2，否则 3×3；格数 = 列² 与影片数取小；
 * - 每格放哪部：开场按顺序放，某格播完就从队列里取下一部，跳过屏上已有的；影片不多于格数时原地重播；
 * - 哪几格真放视频：同时播放上限（用户设，默认 4）与降级上限取小；选中格优先，
 *   其余按格序；解码失败过的、只有缓存图的影片只放图，不占名额；
 * - 降级：播放吃力（卡顿 / 掉帧）时每次少一个名额，最少 1；用户重新设上限时从新上限开始。
 */

/** 「同时播放」可选的上限。 */
export const WALL_LIVE_CHOICES = [1, 2, 4, 6, 9] as const

/** 默认同时播放 4 格。 */
export const DEFAULT_MAX_LIVE = 4

/** 3×3 需要的最小窗口尺寸（更小就 2×2，每格太小看不清）。 */
const MIN_WIDTH_3 = 960
const MIN_HEIGHT_3 = 600

/**
 * 列数（行数相同）。
 * @param poolSize - 可放的影片数
 * @param viewport - 窗口尺寸
 */
export function wallColumns(
  poolSize: number,
  viewport: { width: number; height: number }
): 2 | 3 {
  if (poolSize <= 4) return 2
  return viewport.width < MIN_WIDTH_3 || viewport.height < MIN_HEIGHT_3 ? 2 : 3
}

/** 决定能否播放的几个条件。 */
export interface WallPlaybackState {
  /** 窗口被隐藏 / 最小化（document.hidden） */
  hidden: boolean
  /** 用户按空格暂停 */
  paused: boolean
  /** 系统开启了「减少动态效果」 */
  reducedMotion: boolean
}

/** 三个条件都不成立才播放。 */
export function canPlay(state: WallPlaybackState): boolean {
  return !state.hidden && !state.paused && !state.reducedMotion
}

/** 一面视频墙的调度器。 */
export interface WallSchedule {
  /** 格数 */
  readonly cells: number
  /** 第 slot 格当前的影片 id */
  itemAt(slot: number): number
  /** 真放视频的格（升序） */
  liveSlots(): number[]
  isLive(slot: number): boolean
  /** 第 slot 格播完：换下一部并返回它的 id；影片不多于格数时不换，返回 null */
  advance(slot: number): number | null
  /** 选中一格（越界夹到格内） */
  select(slot: number): void
  selected(): number
  /** 用户设的同时播放上限 */
  setMaxLive(limit: number): void
  /** 当前生效的上限（用户上限与降级上限取小） */
  maxLive(): number
  /** 少一个播放名额（最少 1），返回生效的上限 */
  degrade(): number
  /** 这部影片只放图（播不了，或只有缓存图），不再占播放名额 */
  markStatic(itemId: number): void
}

/**
 * 新建调度器。
 * @param pool - 影片 id（按显示顺序）
 * @param cells - 格数上限（列²）
 * @param maxLive - 同时播放上限
 */
export function createWallSchedule(
  pool: readonly number[],
  cells: number,
  maxLive: number
): WallSchedule {
  const count = Math.min(cells, pool.length)
  const slots = pool.slice(0, count)
  const statics = new Set<number>()
  let cursor = count
  let selected = 0
  let limit = Math.max(1, maxLive)
  let cap = limit

  const effective = (): number => Math.min(limit, cap)

  function liveSlots(): number[] {
    const order = [selected, ...slots.keys()].filter(
      (slot, i, all) => all.indexOf(slot) === i
    )
    return order
      .filter(slot => !statics.has(slots[slot]))
      .slice(0, effective())
      .sort((a, b) => a - b)
  }

  return {
    cells: count,
    itemAt: slot => slots[slot],
    liveSlots,
    isLive: slot => liveSlots().includes(slot),
    advance(slot) {
      if (pool.length <= count) return null
      const others = new Set(slots.filter((_, i) => i !== slot))
      for (let tries = 0; tries < pool.length; tries++) {
        const next = pool[cursor % pool.length]
        cursor = (cursor + 1) % pool.length
        if (!others.has(next) && next !== slots[slot]) {
          slots[slot] = next
          return next
        }
      }
      return null
    },
    select(slot) {
      selected = Math.min(Math.max(0, slot), count - 1)
    },
    selected: () => selected,
    setMaxLive(next) {
      limit = cap = Math.max(1, next)
    },
    maxLive: effective,
    degrade() {
      cap = Math.max(1, effective() - 1)
      return cap
    },
    markStatic(itemId) {
      statics.add(itemId)
    },
  }
}
