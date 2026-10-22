import { describe, expect, it } from 'vitest'
import {
  activeCount,
  activeFacets,
  isSelected,
  toggleValue,
} from '../../../src/renderer/src/features/library/facets/facet-rules'

describe('facet-rules', () => {
  it('点选切换返回新对象，去掉最后一个值时整个分面消失', () => {
    const a = toggleValue({}, 'tag', '巨乳')
    expect(a).toEqual({ tag: ['巨乳'] })
    const b = toggleValue(a, 'kind', 'fc2')
    expect(b).toEqual({ tag: ['巨乳'], kind: ['fc2'] })
    expect(a).toEqual({ tag: ['巨乳'] })
    expect(isSelected(b, 'kind', 'fc2')).toBe(true)
    expect(toggleValue(b, 'tag', '巨乳')).toEqual({ kind: ['fc2'] })
  })

  it('已选条件按分面顺序列出，类型显示中文', () => {
    const filter = { actor: ['河北彩花'], kind: ['uncensored' as const] }
    expect(activeFacets(filter)).toEqual([
      { field: 'kind', value: 'uncensored', label: '无码' },
      { field: 'actor', value: '河北彩花', label: '河北彩花' },
    ])
    expect(activeCount(filter)).toBe(2)
    expect(activeCount({})).toBe(0)
  })
})
