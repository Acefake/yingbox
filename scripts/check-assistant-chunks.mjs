#!/usr/bin/env node
/**
 * AI 助手的打包隔离检查（构建后手动跑：node scripts/check-assistant-chunks.mjs）。
 *
 * 读 out/renderer/assets/*.js：
 * - 助手核心所在的 chunk（含「问影盒」或 assistant_intent 的文件）不许出现敏感词；
 * - 私密技能包（含「问私密库」）必须在独立 chunk 里，不与入口 chunk、助手核心 chunk 合并；
 * - 入口 chunk 不许含私密技能包的提示词。
 * 入口 chunk 里路由表、侧栏等既有的私密分区名不在本检查范围（它们不属于助手）。
 * 没有构建产物时以退出码 2 结束。
 *
 * 用法：node scripts/check-assistant-chunks.mjs [--dir out/renderer/assets]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dirArg = process.argv.indexOf('--dir')
const DIR = join(
  ROOT,
  dirArg > 0 ? process.argv[dirArg + 1] : join('out', 'renderer', 'assets')
)

/** 助手核心 chunk 里不许出现的字样（与 tests/assistant-fixtures.ts 一致） */
export const SENSITIVE =
  /成人|番号|无码|有码|去码|马赛克|女优|私密库|\bjav\b|\bav\b|lada/i
const CORE_MARKERS = ['问影盒', 'assistant_intent']
const PRIVATE_MARKER = '问私密库'

/**
 * 检查一组 chunk，返回问题列表（空表示通过）。
 * @param {{ name: string, code: string }[]} chunks
 * @param {string} entryName 入口 chunk 文件名
 */
export function checkChunks(chunks, entryName) {
  const problems = []
  const core = chunks.filter(c => CORE_MARKERS.some(m => c.code.includes(m)))
  const privates = chunks.filter(c => c.code.includes(PRIVATE_MARKER))
  if (!core.length) problems.push('找不到助手核心 chunk（含「问影盒」）')
  for (const chunk of core) {
    const hit = SENSITIVE.exec(chunk.code)
    if (hit) problems.push(`${chunk.name} 含敏感词「${hit[0]}」`)
  }
  if (privates.length !== 1)
    problems.push(`私密技能应在恰好一个 chunk 里，实际 ${privates.length} 个`)
  for (const chunk of privates) {
    if (chunk.name === entryName) problems.push('私密技能被打进了入口 chunk')
    if (core.some(c => c.name === chunk.name))
      problems.push(`私密技能与助手核心在同一个 chunk：${chunk.name}`)
  }
  return problems
}

function main() {
  if (!existsSync(DIR)) {
    console.error(`没有构建产物：${DIR}（先跑 npx electron-vite build）`)
    process.exit(2)
  }
  const chunks = readdirSync(DIR)
    .filter(name => name.endsWith('.js'))
    .map(name => ({ name, code: readFileSync(join(DIR, name), 'utf8') }))
  const html = readFileSync(join(DIR, '..', 'index.html'), 'utf8')
  const entry = /assets\/([^"]+\.js)/.exec(html)?.[1] ?? ''
  const problems = checkChunks(chunks, entry)
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(1)
  }
  console.log('助手打包隔离检查通过')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main()
