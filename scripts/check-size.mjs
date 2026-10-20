#!/usr/bin/env node
/**
 * 单文件行数检查（pnpm check:size）。
 *
 * 扫描 src/ 下的 .ts / .vue / .mjs 文件，列出超过上限（默认 400 行）的文件。
 * 现阶段只警告、不失败；阶段 4 拆完巨型文件后加 --strict 改为报错。
 *
 * 用法：node scripts/check-size.mjs [--limit 400] [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXTENSIONS = /\.(ts|vue|mjs)$/

/** 递归列出 dir 下所有源文件（跳过 node_modules） */
function listSources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSources(full))
    else if (EXTENSIONS.test(entry.name)) out.push(full)
  }
  return out
}

/** 统计 src/ 下每个源文件的行数，按行数降序返回 */
export function measureLines(root = ROOT) {
  return listSources(join(root, 'src'))
    .map(file => ({
      file: relative(root, file).split('\\').join('/'),
      lines: readFileSync(file, 'utf8').split('\n').length,
    }))
    .sort((a, b) => b.lines - a.lines)
}

function main() {
  const args = process.argv.slice(2)
  const limitIndex = args.indexOf('--limit')
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 400
  const strict = args.includes('--strict')

  const oversized = measureLines().filter(item => item.lines > limit)
  if (!oversized.length) {
    console.log(`单文件行数检查通过（上限 ${limit} 行）`)
    return
  }
  console.warn(`⚠ ${oversized.length} 个文件超过 ${limit} 行：`)
  for (const { file, lines } of oversized) {
    console.warn(`  ${String(lines).padStart(5)}  ${file}`)
  }
  if (strict) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
