/**
 * 按画面搜的结果合并与排序（纯函数）：封面、剧照和视频帧的匹配都按条目合并，
 * 每部取最像的一个画面排序；抽过帧的片另带最像的几个视频画面（时间点），点了能从那里播放。
 */
import type { VisualHit, VisualMoment } from '../../../shared/library/ipc'

/** 每部最多带几个视频画面。 */
export const MOMENTS_PER_ITEM = 3

/** 一行匹配：图片（frame 缺省）或视频帧。 */
export interface ScoredRow {
  itemId: number
  score: number
  image: string
  frame?: { fileId: number; atMs: number }
}

/** 分数保留三位小数（只用于排序与相对比较）。 */
const round = (score: number): number => Math.round(score * 1000) / 1000

/**
 * 合并排序：每部取分数最高的一行作为结果图（同分时先出现的优先），按它降序取前 limit 部；
 * 视频画面按分数降序取前 MOMENTS_PER_ITEM 个。片名由调用方补。
 */
export function rankHits(
  rows: Iterable<ScoredRow>,
  limit: number
): Array<Omit<VisualHit, 'title'>> {
  const best = new Map<number, ScoredRow>()
  const frames = new Map<number, ScoredRow[]>()
  for (const row of rows) {
    const current = best.get(row.itemId)
    if (!current || row.score > current.score) best.set(row.itemId, row)
    if (row.frame) {
      const list = frames.get(row.itemId)
      if (list) list.push(row)
      else frames.set(row.itemId, [row])
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(top => {
      const moments: VisualMoment[] = (frames.get(top.itemId) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, MOMENTS_PER_ITEM)
        .map(m => ({
          fileId: m.frame!.fileId,
          at: m.frame!.atMs / 1000,
          image: m.image,
          score: round(m.score),
        }))
      return {
        itemId: top.itemId,
        score: round(top.score),
        image: top.image,
        ...(top.frame
          ? { frame: { fileId: top.frame.fileId, at: top.frame.atMs / 1000 } }
          : {}),
        ...(moments.length ? { moments } : {}),
      }
    })
}
