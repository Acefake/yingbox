import { describe, expect, it } from 'vitest'
import {
  AMBIENT_TONES,
  ambientPosterOf,
  ambientVars,
} from '../../../src/renderer/src/features/library/ambient/ambient-rules'

/** 模拟 PagedList：未加载的格是 undefined。 */
const listOf = (
  items: Array<{ poster: string | null } | undefined>
): {
  length: number
  at: (i: number) => { poster: string | null } | undefined
} => ({
  length: items.length,
  at: (i: number) => items[i],
})

describe('ambientPosterOf', () => {
  it('取第一张有海报的', () => {
    const list = listOf([
      undefined,
      { poster: null },
      { poster: 'a.jpg' },
      { poster: 'b.jpg' },
    ])
    expect(ambientPosterOf(list)).toBe('a.jpg')
  })

  it('只看前几格，后面的不算', () => {
    const list = listOf([
      { poster: null },
      { poster: null },
      { poster: 'late.jpg' },
    ])
    expect(ambientPosterOf(list, 2)).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(ambientPosterOf(listOf([]))).toBeNull()
  })
})

describe('ambientVars', () => {
  it('每个分区各有一套色，变量名固定', () => {
    const sections = [
      'movie',
      'tv',
      'anime',
      'variety',
      'documentary',
      'jav',
    ] as const
    for (const section of sections) {
      expect(ambientVars(section)).toEqual({
        '--ambient-accent': AMBIENT_TONES[section].accent,
        '--ambient-glow': AMBIENT_TONES[section].glow,
      })
    }
    expect(new Set(Object.values(AMBIENT_TONES).map(t => t.accent)).size).toBe(
      sections.length
    )
  })
})
