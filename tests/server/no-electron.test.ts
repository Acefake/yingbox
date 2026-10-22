// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
/**
 * 核心与宿主分离的守卫：从独立服务入口出发，沿相对 import 走完整张依赖图，任何文件都不能 import electron
 * （类型导入也不行——核心应只依赖接口，Electron 实现只在桌面宿主文件里）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate
  }
  return null
}

/** 入口能到达的全部源文件，以及它们 import 的外部模块。 */
function walk(entry: string): {
  files: string[]
  externals: Map<string, string[]>
} {
  const seen = new Set<string>()
  const externals = new Map<string, string[]>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2]
      if (spec.startsWith('.')) {
        const target = resolveImport(file, spec)
        if (target) stack.push(target)
      } else {
        const list = externals.get(spec) ?? []
        list.push(relative(ROOT, file))
        externals.set(spec, list)
      }
    }
  }
  return { files: [...seen], externals }
}

describe('片库核心不依赖 Electron', () => {
  it('独立服务的整张依赖图里没有 electron', () => {
    const { files, externals } = walk(join(ROOT, 'src/server/index.ts'))
    expect(files.length).toBeGreaterThan(50)
    expect(externals.get('electron') ?? []).toEqual([])
    expect(
      [...externals.keys()].filter(name => name.startsWith('@electron'))
    ).toEqual([])
  })

  it('编解码线程也不依赖 electron', () => {
    const { externals } = walk(join(ROOT, 'src/main/thumbnails/webp-worker.ts'))
    expect(externals.get('electron') ?? []).toEqual([])
  })
})
