import { describe, expect, it } from 'vitest'
import { matchingTmdbCandidates } from '@/features/online/utils/tmdb-match'

describe('在线元数据作品身份匹配', () => {
  it('译名不同时可按原名匹配，保留 NFKC 与标点归一化', () => {
    const hit = {
      id: 1,
      title: '外文作品',
      original_title: 'Ａ Movie: One',
      release_date: '2020-01-01',
    }
    expect(
      matchingTmdbCandidates([hit], {
        title: '中文名',
        originalTitle: 'A Movie One',
        year: '2020',
        kind: 'movie',
      })
    ).toEqual([hit])
  })

  it('中文片名相同但已知原名冲突时不匹配', () => {
    expect(
      matchingTmdbCandidates(
        [{ id: 1, title: '同名', original_title: 'Other' }],
        {
          title: '同名',
          originalTitle: 'Original',
          kind: 'movie',
        }
      )
    ).toEqual([])
  })

  it('不同季的名称不能按包含关系匹配到整部剧', () => {
    expect(
      matchingTmdbCandidates([{ id: 1, name: '某剧' }], {
        title: '某剧 第二季',
        kind: 'tv',
      })
    ).toEqual([])
  })

  it('已知年份时不采用缺年份的候选；multi 的人物结果不匹配电影', () => {
    expect(
      matchingTmdbCandidates([{ id: 1, title: '同名' }], {
        title: '同名',
        year: '2020',
        kind: 'movie',
      })
    ).toEqual([])
    expect(
      matchingTmdbCandidates([{ id: 1, name: '同名', media_type: 'person' }], {
        title: '同名',
        kind: 'movie',
      })
    ).toEqual([])
  })
})
