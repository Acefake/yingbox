#!/usr/bin/env node
/**
 * 静态性能指标（pnpm perf:static）：沙箱/CI 里不需要启动 Electron 就能测的部分。
 *
 * - 依赖数：pnpm 解析出的生产依赖 / 全部依赖（去重后的包目录数）
 * - out/ 构建产物：main、preload、renderer 各进程体积（原始 + gzip）
 * - renderer 最大的 JS/CSS chunk
 * - 单文件行数前 10
 *
 * 先跑 `pnpm build:nocheck` 生成 out/。结果以 Markdown 打到 stdout，
 * 供 docs/perf/*.md 直接粘贴、逐阶段对比。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { measureLines } from './check-size.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'out')

/** 递归列出目录下全部文件 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`

/** 一组文件的原始体积与 gzip 体积 */
function sizeOf(files) {
  let raw = 0
  let gzip = 0
  for (const file of files) {
    const data = readFileSync(file)
    raw += data.length
    gzip += gzipSync(data).length
  }
  return { raw, gzip }
}

/** pnpm list 的去重包数；pnpm 不可用时返回 null */
function countDeps(flag) {
  try {
    const out = execSync(`pnpm list ${flag} --depth Infinity --parseable`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
    return new Set(out.split('\n').filter(Boolean)).size - 1
  } catch {
    return null
  }
}

function main() {
  const lines = []
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  lines.push('### 依赖')
  lines.push(`- package.json dependencies：${Object.keys(pkg.dependencies ?? {}).length} 个`)
  lines.push(`- 解析后的生产依赖（含传递）：${countDeps('--prod') ?? '未测'} 个`)
  lines.push(`- 解析后的全部依赖（含 dev）：${countDeps('') ?? '未测'} 个`)

  if (!existsSync(OUT)) {
    lines.push('', '> out/ 不存在：先运行 `pnpm build:nocheck`')
  } else {
    lines.push('', '### 构建产物（out/）', '| 进程 | 文件数 | 原始 | gzip |', '|---|---|---|---|')
    for (const proc of ['main', 'preload', 'renderer']) {
      const dir = join(OUT, proc)
      if (!existsSync(dir)) continue
      const files = walk(dir).filter(f => /\.(js|css|html)$/.test(f))
      const { raw, gzip } = sizeOf(files)
      lines.push(`| ${proc} | ${files.length} | ${kb(raw)} | ${kb(gzip)} |`)
    }
    const assets = join(OUT, 'renderer', 'assets')
    if (existsSync(assets)) {
      const chunks = walk(assets)
        .filter(f => /\.(js|css)$/.test(f))
        .map(f => ({ file: relative(assets, f), raw: statSync(f).size, gzip: sizeOf([f]).gzip }))
        .sort((a, b) => b.raw - a.raw)
      lines.push('', '### renderer chunk（前 10）', '| chunk | 原始 | gzip |', '|---|---|---|')
      for (const chunk of chunks.slice(0, 10)) {
        lines.push(`| ${chunk.file} | ${kb(chunk.raw)} | ${kb(chunk.gzip)} |`)
      }
    }
  }

  const sizes = measureLines()
  lines.push('', '### 单文件行数（前 10）', '| 行数 | 文件 |', '|---|---|')
  for (const { file, lines: count } of sizes.slice(0, 10)) lines.push(`| ${count} | ${file} |`)
  lines.push('', `超过 400 行的文件：${sizes.filter(s => s.lines > 400).length} 个`)

  console.log(lines.join('\n'))
}

main()
