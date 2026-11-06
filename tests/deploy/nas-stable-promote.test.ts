/**
 * 发布流程把 NAS 镜像推送给自动更新用户的方式（ADR-0054）：
 * stable 标签必须在双架构镜像合并后由 CI 推进，且推进前每个架构都在自己的 runner 上验证过。
 */
// test-affected: repo-wide（读 .github/workflows 源码文本，vitest 依赖图看不到这层依赖）
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(__dirname, '../../.github/workflows/release.yml'),
  'utf8'
)

/** 取出一个 job 的文本（到下一个同级 job 之前）。 */
function job(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:$`, 'm'))
  expect(start, `找不到 job ${name}`).toBeGreaterThanOrEqual(0)
  const rest = workflow.slice(start + 1)
  const next = rest.search(/^ {2}[a-z][\w-]*:$/m)
  return next < 0 ? rest : rest.slice(0, next)
}

describe('NAS 稳定版标签推进', () => {
  it('nas-manifest 在合并双架构后推进 stable', () => {
    const manifest = job('nas-manifest')
    expect(manifest).toMatch(/imagetools create/)
    expect(manifest).toMatch(/promoteNasStable/)
  })

  it('推进 stable 的是 CI 而不是只靠本机发布', () => {
    expect(workflow).toMatch(/promoteNasStable/)
    // 只在 push（真发版）推进，演练不推进
    expect(job('nas-manifest')).toMatch(/github\.event_name == 'push'/)
  })

  it('推进 stable 前每个架构都在自己的 runner 上验证过镜像', () => {
    const nas = job('nas')
    expect(nas).toMatch(/verifyNasImage/)
    // 验证要用刚构建出来的那个摘要，不是 :stable 或版本标签
    expect(nas).toMatch(/steps\.build\.outputs\.digest/)
  })

  it('nas-manifest 能拿到发布脚本（需要 checkout）', () => {
    const manifest = job('nas-manifest')
    expect(manifest).toMatch(/actions\/checkout@v4/)
  })

  it('stable 推进有写镜像包的权限', () => {
    expect(job('nas-manifest')).toMatch(/packages: write/)
  })
})
