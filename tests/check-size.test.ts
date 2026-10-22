// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
import { describe, expect, it } from 'vitest'
import { measureLines, oversizedFiles } from '../scripts/check-size.mjs'

describe('check:size', () => {
  it('超过上限的文件被挑出，刚好等于上限不算', () => {
    expect(
      oversizedFiles(
        [
          { file: 'a.ts', lines: 401 },
          { file: 'b.vue', lines: 400 },
          { file: 'c.mjs', lines: 900 },
        ],
        400
      )
    ).toEqual([
      { file: 'a.ts', lines: 401 },
      { file: 'c.mjs', lines: 900 },
    ])
  })

  it('当前仓库在严格模式下通过（没有豁免）', () => {
    expect(oversizedFiles(measureLines(), 400)).toEqual([])
  })
})
