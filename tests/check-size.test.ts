import { describe, expect, it } from 'vitest'
import { EXEMPT, classify, measureLines } from '../scripts/check-size.mjs'

/** 影视（媒体库）模块范围：豁免只能落在这里 */
const FILM_PROTECTED = [
  /^src\/main\/library\//,
  /^src\/shared\/library\//,
  /^src\/renderer\/src\/features\/library\//,
  /^src\/preload\/library-bridge\.ts$/,
  /^src\/renderer\/src\/api\/tmdb\.ts$/,
  /^src\/renderer\/src\/stores\/scrape-provider-store\.ts$/,
  /^src\/renderer\/src\/components\/ScrapeQueuePanel\.vue$/,
  /^src\/renderer\/src\/composables\/use-global-queue\.ts$/,
  /^src\/renderer\/src\/features\/settings\/legacy-library-mirror\.ts$/,
]

describe('check:size 分类', () => {
  const exempt = { 'a.vue': 500, 'gone.ts': 600, 'small.ts': 450 }

  it('超标且未豁免的文件失败', () => {
    const r = classify([{ file: 'b.ts', lines: 401 }], 400, exempt)
    expect(r.oversized.map(i => i.file)).toEqual(['b.ts'])
  })

  it('刚好等于上限不算超标', () => {
    const r = classify([{ file: 'b.ts', lines: 400 }], 400, exempt)
    expect(r.oversized).toEqual([])
  })

  it('豁免文件在天花板内放行，超过天花板照样失败', () => {
    const ok = classify([{ file: 'a.vue', lines: 500 }], 400, exempt)
    expect(ok.oversized).toEqual([])
    expect(ok.exempted.map(i => i.file)).toEqual(['a.vue'])
    const grown = classify([{ file: 'a.vue', lines: 501 }], 400, exempt)
    expect(grown.oversized).toEqual([
      { file: 'a.vue', lines: 501, ceiling: 500 },
    ])
  })

  it('文件被删或降到上限内时，提示豁免过期', () => {
    const r = classify(
      [
        { file: 'a.vue', lines: 450 },
        { file: 'small.ts', lines: 300 },
      ],
      400,
      exempt
    )
    expect(r.stale.sort()).toEqual(['gone.ts', 'small.ts'])
  })

  it('豁免清单只含影视模块文件', () => {
    for (const file of Object.keys(EXEMPT)) {
      expect(FILM_PROTECTED.some(re => re.test(file)), file).toBe(true)
    }
  })

  it('当前仓库在严格模式下通过', () => {
    const r = classify(measureLines(), 400)
    expect(r.oversized).toEqual([])
  })
})
