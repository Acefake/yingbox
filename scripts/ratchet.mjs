/**
 * 「只减不增」基线（ratchet）的共用逻辑：style-tokens 的视觉规则与 check-copy 共用。
 *
 * 基线是 `{ 文件: { 规则: 次数 } }`，存成 scripts/baselines/*.json。比较当前计数与基线：
 *   - grown：某文件某规则的次数超过基线（新增违规）→ 检查失败；
 *   - stale：次数低于基线（有人顺手修掉了）→ 也失败，提示运行 --update-baseline 收紧，
 *     不收紧的话，修掉的名额会被后来的改动悄悄用掉。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * 把逐条发现汇总成 `{ 文件: { 规则: 次数 } }`，键按字典序排列，写出的 JSON 稳定可 diff。
 *
 * @param {{ file: string, rule: string }[]} findings 逐条发现
 * @returns {Record<string, Record<string, number>>}
 */
export function countFindings(findings) {
  /** @type {Record<string, Record<string, number>>} */
  const counts = {}
  for (const { file, rule } of findings) {
    counts[file] ??= {}
    counts[file][rule] = (counts[file][rule] ?? 0) + 1
  }
  return sortKeys(counts)
}

/**
 * 比较当前计数与基线。
 *
 * @param {Record<string, Record<string, number>>} baseline 基线
 * @param {Record<string, Record<string, number>>} current 当前计数
 * @returns {{ grown: Entry[], stale: Entry[] }}
 *
 * @typedef {{ file: string, rule: string, baseline: number, current: number }} Entry
 */
export function compareCounts(baseline, current) {
  const grown = []
  const stale = []
  const files = new Set([...Object.keys(baseline), ...Object.keys(current)])
  for (const file of [...files].sort()) {
    const rules = new Set([
      ...Object.keys(baseline[file] ?? {}),
      ...Object.keys(current[file] ?? {}),
    ])
    for (const rule of [...rules].sort()) {
      const was = baseline[file]?.[rule] ?? 0
      const now = current[file]?.[rule] ?? 0
      const entry = { file, rule, baseline: was, current: now }
      if (now > was) grown.push(entry)
      else if (now < was) stale.push(entry)
    }
  }
  return { grown, stale }
}

/** 读基线文件；不存在时当作空基线 */
export function readBaseline(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

/** 写基线文件（两空格缩进、末尾换行，与 prettier 一致） */
export function writeBaseline(file, counts) {
  writeFileSync(file, JSON.stringify(sortKeys(counts), null, 2) + '\n')
}

/**
 * 把比较结果写成给人看的几行；没有问题时返回空数组。
 *
 * @param {{ grown: Entry[], stale: Entry[] }} result compareCounts 的结果
 * @param {string} command 收紧基线的命令
 */
export function describeRatchet({ grown, stale }, command) {
  const lines = grown.map(
    e =>
      `${e.file}: ${e.rule} ${e.current} 处，基线 ${e.baseline} 处（只减不增）`
  )
  if (stale.length) {
    lines.push(
      `${stale.length} 项比基线少了，请运行 ${command} 收紧基线：`,
      ...stale.map(e => `  ${e.file}: ${e.rule} ${e.baseline} → ${e.current}`)
    )
  }
  return lines
}

function sortKeys(counts) {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .filter(file => Object.keys(counts[file]).length)
      .map(file => [
        file,
        Object.fromEntries(
          Object.keys(counts[file])
            .sort()
            .map(rule => [rule, counts[file][rule]])
        ),
      ])
  )
}
