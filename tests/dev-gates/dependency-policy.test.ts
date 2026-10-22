/**
 * 依赖策略：package.json 的依赖写精确版本（锁文件之外再锁一道，升级要显式改版本号）。
 * 规则之前已有的范围版本列在 scripts/baselines/dependency-ranges.json，只能改成精确版本或删除，不能新增。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** 无论是否在基线里都不允许：任意版本、标签、git / 网址 / 本地路径 */
const FORBIDDEN =
  /^(?:\*|latest|next|x|)$|^(?:git|github:|https?:|file:|link:)|\.x\b/

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<
  string,
  Record<string, string> | undefined
>
const baseline = JSON.parse(
  readFileSync('scripts/baselines/dependency-ranges.json', 'utf8')
) as Record<string, string[]>

describe('依赖策略', () => {
  it('新依赖写精确版本；基线里的范围版本不新增', () => {
    const offenders = SECTIONS.flatMap(section =>
      Object.entries(pkg[section] ?? {})
        .filter(
          ([name, spec]) =>
            !EXACT.test(spec) && !baseline[section]?.includes(name)
        )
        .map(([name, spec]) => `${section}.${name}: ${spec}`)
    )
    expect(offenders, '请写精确版本，如 "1.2.3"').toEqual([])
  })

  it('基线只减不增：已改成精确版本或已删除的依赖要从基线里去掉', () => {
    const stale = Object.entries(baseline).flatMap(([section, names]) =>
      names
        .filter(name => {
          const spec = pkg[section]?.[name]
          return spec === undefined || EXACT.test(spec)
        })
        .map(name => `${section}.${name}`)
    )
    expect(stale).toEqual([])
    for (const names of Object.values(baseline))
      expect(names).toEqual([...names].sort())
  })

  it('不允许任意版本、标签、git / 网址 / 本地路径依赖', () => {
    const bad = SECTIONS.flatMap(section =>
      Object.entries(pkg[section] ?? {})
        .filter(([, spec]) => FORBIDDEN.test(spec))
        .map(([name, spec]) => `${section}.${name}: ${spec}`)
    )
    expect(bad).toEqual([])
  })

  it('锁文件在仓库里', () => {
    expect(existsSync('pnpm-lock.yaml')).toBe(true)
  })
})
