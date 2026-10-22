// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { boundaryViolation } from '../scripts/eslint/feature-boundaries.mjs'

const AV_VIEW = 'src/renderer/src/features/av/views/AvView.vue'

describe('feature 边界判定', () => {
  it('跨 feature 深引用越界，经 index 不越界', () => {
    expect(
      boundaryViolation(
        AV_VIEW,
        '@/features/player/composables/use-media-player'
      )
    ).toBe('player')
    expect(boundaryViolation(AV_VIEW, '@/features/player')).toBeNull()
    expect(boundaryViolation(AV_VIEW, '@/features/player/index')).toBeNull()
    expect(boundaryViolation(AV_VIEW, '../../player/utils/play-progress')).toBe(
      'player'
    )
    expect(boundaryViolation(AV_VIEW, '../../player')).toBeNull()
  })

  it('同 feature、共享模块、第三方包、feature 之外的组合层不受限', () => {
    expect(
      boundaryViolation(AV_VIEW, '../components/AvSearchResults.vue')
    ).toBeNull()
    expect(
      boundaryViolation(AV_VIEW, '@/features/av/utils/av-media')
    ).toBeNull()
    expect(
      boundaryViolation(AV_VIEW, '@/components/ui/UiButton.vue')
    ).toBeNull()
    expect(boundaryViolation(AV_VIEW, 'vue')).toBeNull()
    expect(
      boundaryViolation(
        'src/renderer/src/router/routers.ts',
        '@/features/av/views/AvView.vue'
      )
    ).toBeNull()
  })
})

// 首次 lintText 要加载整份 eslint 配置（typescript-eslint、vue、prettier 插件），
// 机器负载高时会超过 vitest 默认的 5 秒；只跑边界规则并放宽本组超时
describe('eslint 配置里规则生效', { timeout: 30_000 }, () => {
  const eslint = new ESLint({
    cwd: process.cwd(),
    ruleFilter: ({ ruleId }) => ruleId === 'yingbox/feature-boundaries',
  })
  const lint = async (code: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, {
      filePath: 'src/renderer/src/features/av/composables/boundary-probe.ts',
    })
    return result.messages.map(m => m.ruleId ?? '')
  }

  it('静态 / 动态 / re-export 深引用都报错', async () => {
    const code = [
      "import { openMediaPlayer } from '@/features/player/composables/use-media-player'",
      "export { getJson } from '@/features/online/api/online'",
      "export const load = () => import('@/features/lada/components/LadaSettings.vue')",
      'export { openMediaPlayer }',
      '',
    ].join('\n')
    const rules = await lint(code)
    expect(rules.filter(r => r === 'yingbox/feature-boundaries')).toHaveLength(
      3
    )
  })

  it('经公共出口引用不报错', async () => {
    const code =
      "import { openMediaPlayer } from '@/features/player'\n\nexport { openMediaPlayer }\n"
    expect(await lint(code)).not.toContain('yingbox/feature-boundaries')
  })
})
