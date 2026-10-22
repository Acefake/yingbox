#!/usr/bin/env node
/**
 * 文案只写最终状态（pnpm check:copy）。
 *
 * 界面文案和注释描述「现在是什么」，不写「改为 / 原先 / 之前是 / 旧版」这类改动对比：
 * 读者看不到被比较的那一版，变更过程写进提交记录和 PR。扫描 src/ 下的 .ts / .vue / .mjs /
 * .css 每一行（注释与字符串都算）。
 *
 * 现存命中记在 scripts/baselines/copy-final-state.json，只减不增；确实不是改动对比的一行
 * （比如「旧版配置文件」是一种数据格式的名字），在同一行写 `copy-lint: ok` 豁免。
 *
 *   node scripts/check-copy.mjs                     检查
 *   node scripts/check-copy.mjs --update-baseline   修掉命中后收紧基线
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareCounts,
  countFindings,
  describeRatchet,
  readBaseline,
  writeBaseline,
} from './ratchet.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const BASELINE_FILE = join(
  ROOT,
  'scripts/baselines/copy-final-state.json'
)
const EXTENSIONS = /\.(ts|vue|mjs|css)$/
const DISABLE = 'copy-lint: ok'

/** 改动对比字样：[规则名, 正则] */
export const COPY_RULES = [
  [
    'history',
    /原先|原本|以前|曾经|早先|原来(?:是|的(?:实现|写法|做法|逻辑|版本))/g,
  ],
  ['history', /之前(?:是|用|会|这里)|之前的(?:实现|写法|做法|逻辑|版本)/g],
  ['changed-to', /改为|改成|现在改|改回/g],
  ['old-version', /旧版|旧实现|旧写法|旧逻辑|老版本|老实现/g],
  ['history', /\b(?:previously|formerly|no longer|used to be|was changed)\b/gi],
]

/**
 * 逐行找改动对比字样。
 *
 * @param {string} file 文件（相对仓库根，只用于报告）
 * @param {string} text 文件内容
 * @returns {{ file: string, line: number, rule: string, text: string }[]}
 */
export function copyFindings(file, text) {
  const findings = []
  text.split('\n').forEach((line, index) => {
    if (line.includes(DISABLE)) return
    for (const [rule, pattern] of COPY_RULES) {
      for (const match of line.matchAll(pattern))
        findings.push({ file, line: index + 1, rule, text: match[0] })
    }
  })
  return findings
}

/** 扫描仓库 src/ 下全部受检文件 */
export function scanRepo(root = ROOT) {
  const out = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (EXTENSIONS.test(entry.name)) {
        const rel = relative(root, full).split('\\').join('/')
        out.push(...copyFindings(rel, readFileSync(full, 'utf8')))
      }
    }
  }
  walk(join(root, 'src'))
  return out
}

function main() {
  const findings = scanRepo()
  const counts = countFindings(findings)
  if (process.argv.includes('--update-baseline')) {
    writeBaseline(BASELINE_FILE, counts)
    console.log(`已写入文案基线：${findings.length} 处`)
  }
  const result = compareCounts(readBaseline(BASELINE_FILE), counts)
  const grown = new Set(result.grown.map(e => `${e.file}\0${e.rule}`))
  for (const f of findings.filter(f => grown.has(`${f.file}\0${f.rule}`)))
    console.log(
      `${f.file}:${f.line}: 「${f.text}」是改动对比，文案只写最终状态`
    )
  const lines = describeRatchet(
    result,
    'node scripts/check-copy.mjs --update-baseline'
  )
  for (const line of lines) console.log(line)
  if (lines.length) process.exit(1)
  console.log('文案检查通过')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main()
