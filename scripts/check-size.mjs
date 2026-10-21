#!/usr/bin/env node
/**
 * 单文件行数检查（pnpm check:size）。
 *
 * 扫描 src/ 下的 .ts / .vue / .mjs 文件，列出超过上限（默认 400 行）的文件。
 * 不加 --strict 只警告；加 --strict 时有超标文件就以退出码 1 失败（`pnpm lint` 与 CI 用这个）。
 *
 * 豁免：影视（媒体库）模块由库重构项目负责拆分，
 * 所以把它们合入时已超标的文件列进 EXEMPT，并以「当前行数」为天花板：
 * 只允许变短，不允许再变长。文件拆到 400 行以内或被删掉后，脚本会提示从清单里移除。
 *
 * 用法：node scripts/check-size.mjs [--limit 400] [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXTENSIONS = /\.(ts|vue|mjs)$/

/**
 * 影视（媒体库）模块的豁免清单：路径 → 允许的最大行数（登记时的行数）。
 * 媒体库由另一条重构线维护，合入 main 时已超标的文件在这里登记，拆完一个删一行。
 */
export const EXEMPT = {
  'src/renderer/src/features/library/detail/ItemDetail.vue': 932,
  'src/renderer/src/features/library/LibraryPage.vue': 718,
  'src/renderer/src/features/library/review/MatchPane.vue': 485,
  'src/renderer/src/features/library/settings/LibrarySettings.vue': 485,
  'src/renderer/src/features/library/wall/PosterWall.vue': 425,
}

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

/**
 * 按上限与豁免清单给文件分类（纯函数，供测试）。
 *
 * - oversized：超过上限且不在豁免清单里，或在清单里但超过了登记的天花板
 * - exempted：在清单里、超过上限、但没超过天花板
 * - stale：清单里已经不需要的条目（文件不存在，或已降到上限以内）
 *
 * @param {{ file: string, lines: number }[]} measured measureLines() 的结果
 * @param {number} limit 单文件行数上限
 * @param {Record<string, number>} exempt 豁免清单
 */
export function classify(measured, limit, exempt = EXEMPT) {
  const oversized = []
  const exempted = []
  const seen = new Map(measured.map(item => [item.file, item.lines]))
  for (const item of measured) {
    if (item.lines <= limit) continue
    const ceiling = exempt[item.file]
    if (ceiling !== undefined && item.lines <= ceiling) exempted.push(item)
    else oversized.push({ ...item, ceiling })
  }
  const stale = Object.keys(exempt).filter(file => {
    const lines = seen.get(file)
    return lines === undefined || lines <= limit
  })
  return { oversized, exempted, stale }
}

function main() {
  const args = process.argv.slice(2)
  const limitIndex = args.indexOf('--limit')
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 400
  const strict = args.includes('--strict')

  const { oversized, exempted, stale } = classify(measureLines(), limit)
  for (const file of stale) {
    console.warn(`ℹ 豁免已不需要，请从 EXEMPT 删除：${file}`)
  }
  if (!oversized.length) {
    console.log(
      `单文件行数检查通过（上限 ${limit} 行；影视豁免 ${exempted.length} 个）`
    )
    return
  }
  console.warn(`⚠ ${oversized.length} 个文件超过 ${limit} 行：`)
  for (const { file, lines, ceiling } of oversized) {
    const note =
      ceiling === undefined ? '' : `（豁免天花板 ${ceiling}，又变长了）`
    console.warn(`  ${String(lines).padStart(5)}  ${file}${note}`)
  }
  if (strict) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main()
