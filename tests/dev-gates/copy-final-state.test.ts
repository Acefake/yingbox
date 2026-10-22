// test-affected: repo-wide（扫描 src 全部源码文本）
/**
 * 文案只写最终状态（scripts/check-copy.mjs）：界面文案与注释不写「改为 / 原先 / 之前是 / 旧版」这类改动对比，
 * 现存命中按基线只减不增。
 */
import { describe, expect, it } from 'vitest'
import {
  BASELINE_FILE,
  copyFindings,
  scanRepo,
} from '../../scripts/check-copy.mjs'
import {
  compareCounts,
  countFindings,
  readBaseline,
} from '../../scripts/ratchet.mjs'

const terms = (text: string): string[] =>
  copyFindings('a.ts', text).map(f => f.text)

describe('文案只写最终状态', () => {
  it('找出改动对比字样', () => {
    expect(
      terms(
        [
          '// 原先这里用轮询',
          "toast.info('已改为自动刷新')",
          '/** 之前是按主机熔断 */',
          '// 旧版实现会重复请求',
          '// previously cached in memory',
          '// 原来的写法太慢',
        ].join('\n')
      )
    ).toEqual(['原先', '改为', '之前是', '旧版', 'previously', '原来的写法'])
  })

  it('描述时间先后的「之前」「不再」不算', () => {
    expect(
      terms(
        '// 必须在 ready 之前注册\n// 失败三次后不再重试\n// 关闭之前的窗口'
      )
    ).toEqual([])
  })

  it('同一行写 copy-lint: ok 豁免', () => {
    expect(
      terms("const LEGACY = 'config.json' // 旧版配置文件名 copy-lint: ok")
    ).toEqual([])
  })

  it('报告行号与规则', () => {
    expect(copyFindings('a.ts', 'x\n// 改成 y')).toEqual([
      { file: 'a.ts', line: 2, rule: 'changed-to', text: '改成' },
    ])
  })

  it('当前仓库与基线一致（新增命中失败；修掉了要 --update-baseline 收紧）', () => {
    const result = compareCounts(
      readBaseline(BASELINE_FILE),
      countFindings(scanRepo())
    )
    expect(result).toEqual({ grown: [], stale: [] })
  })
})
