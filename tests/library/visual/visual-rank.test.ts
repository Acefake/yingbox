/**
 * 按画面搜的结果合并排序：图片与视频帧按条目合并、每部取最像的一个画面、带最像的几个时间点。
 */
import { describe, expect, it } from 'vitest'
import {
  MOMENTS_PER_ITEM,
  type ScoredRow,
  rankHits,
} from '../../../src/main/library/visual/visual-rank'

const image = (itemId: number, score: number, url: string): ScoredRow => ({
  itemId,
  score,
  image: url,
})
const frame = (
  itemId: number,
  score: number,
  atMs: number,
  fileId = itemId * 10
): ScoredRow => ({
  itemId,
  score,
  image: `yingbox-media://image/${itemId}-${atMs}`,
  frame: { fileId, atMs },
})

describe('结果合并排序', () => {
  it('每部取最像的一行，按它降序；最像的是帧时带文件与时间点', () => {
    const hits = rankHits(
      [
        image(1, 0.2, 'https://img/cover1.jpg'),
        frame(1, 0.35, 75_000),
        image(2, 0.3, 'https://img/cover2.jpg'),
        frame(2, 0.1, 15_000),
        image(3, 0.25, 'https://img/cover3.jpg'),
      ],
      10
    )
    expect(hits.map(h => h.itemId)).toEqual([1, 2, 3])
    expect(hits[0]).toMatchObject({
      score: 0.35,
      image: 'yingbox-media://image/1-75000',
      frame: { fileId: 10, at: 75 },
    })
    // 封面赢了：结果图是封面，但时间点照样带上
    expect(hits[1]).toMatchObject({ image: 'https://img/cover2.jpg' })
    expect(hits[1]!.frame).toBeUndefined()
    expect(hits[1]!.moments).toEqual([
      {
        fileId: 20,
        at: 15,
        image: 'yingbox-media://image/2-15000',
        score: 0.1,
      },
    ])
    // 没抽过帧的片不带 frame / moments
    expect(hits[2]).toEqual({
      itemId: 3,
      score: 0.25,
      image: 'https://img/cover3.jpg',
    })
  })

  it('时间点按相似度降序，最多 MOMENTS_PER_ITEM 个，可跨文件', () => {
    const [hit] = rankHits(
      [
        frame(1, 0.1, 15_000),
        frame(1, 0.4, 45_000),
        frame(1, 0.3, 75_000, 11),
        frame(1, 0.2, 105_000),
        frame(1, 0.05, 135_000),
      ],
      1
    )
    expect(hit!.moments!.map(m => [m.fileId, m.at])).toEqual([
      [10, 45],
      [11, 75],
      [10, 105],
    ])
    expect(hit!.moments).toHaveLength(MOMENTS_PER_ITEM)
  })

  it('取前 limit 部；同分时先出现的优先；分数保留三位小数', () => {
    const hits = rankHits(
      [
        image(1, 0.123456, 'a'),
        image(2, 0.5, 'b'),
        image(2, 0.5, 'c'),
        image(3, 0.01, 'd'),
      ],
      2
    )
    expect(hits).toEqual([
      { itemId: 2, score: 0.5, image: 'b' },
      { itemId: 1, score: 0.123, image: 'a' },
    ])
  })
})
