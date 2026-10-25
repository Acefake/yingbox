import { expect, it } from 'vitest'
import { readSearchFilter } from '../../../src/renderer/src/features/library/search/route-filter'
it('海报墙接收条件保留排序，不接受未知字段、文件路径和越界分数', () => {
  expect(
    readSearchFilter(
      JSON.stringify({
        genres: ['科幻'],
        ratingMin: 99,
        sort: { field: 'rating', order: 'desc' },
        path: '/private/file',
      })
    )
  ).toEqual({
    genres: ['科幻'],
    ratingMin: 10,
    sort: { field: 'rating', order: 'desc' },
  })
  for (const value of [null, [], '[1]', '{', 'x'.repeat(3001)])
    expect(readSearchFilter(value)).toBeNull()
})
