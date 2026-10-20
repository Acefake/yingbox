/**
 * 样式令牌检查与迁移。
 *
 * 渲染进程的样式里，字号和圆角必须引用 tokens.css 的变量，不能写裸 px。
 *
 *   node scripts/style-tokens.mjs          检查，发现裸值时退出码为 1
 *   node scripts/style-tokens.mjs --fix    把能映射的裸值替换成变量
 *
 * 只处理 .css 文件和 .vue 文件的 <style> 块；tokens.css 本身除外。
 *
 * 另外检查 .vue 模板里不能手写原生 <button>（components/ui/ 除外），
 * 应改用 UiButton / UiIconButton / UiNavItem / UiListRow / UiChip / UiPressable；
 * 也不能手写原生 <input> / <select> / <textarea>，应改用 UiInput / UiSelect /
 * UiTextarea / UiSwitch / UiCheckbox / UiRadio。只有 type 为 file / range / hidden 的
 * <input> 允许保留原生。这两项 --fix 无法自动修复。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src/renderer/src')
const tokensFile = path.join(srcDir, 'assets/styles/tokens.css')
const uiDir = path.join(srcDir, 'components/ui') + path.sep
const fix = process.argv.includes('--fix')

/** 字号 px → 令牌（就近取档，最小 11px） */
const FONT_SIZE = new Map([
  [9, '--text-2xs'],
  [10, '--text-2xs'],
  [11, '--text-2xs'],
  [12, '--text-xs'],
  [13, '--text-sm'],
  [14, '--text-md'],
  [15, '--text-md'],
  [16, '--text-lg'],
  [17, '--text-lg'],
  [18, '--text-lg'],
  [20, '--text-xl'],
  [22, '--text-xl'],
  [24, '--text-2xl'],
  [26, '--text-2xl'],
  [28, '--text-2xl'],
  [32, '--text-3xl'],
  [34, '--text-3xl'],
  [36, '--text-3xl'],
])

/** 圆角 px → 令牌 */
function radiusToken(px) {
  if (px === 0) return null
  if (px <= 4) return '--radius-xs'
  if (px <= 6) return '--radius-sm'
  if (px <= 9) return '--radius-md'
  if (px <= 13) return '--radius-lg'
  if (px <= 20) return '--radius-xl'
  if (px >= 99) return '--radius-full'
  return null
}

const RULES = [
  {
    name: 'font-size',
    pattern: /(font-size\s*:\s*)(\d+(?:\.\d+)?)px/g,
    map: px => FONT_SIZE.get(px) ?? null,
  },
  {
    name: 'border-radius',
    // 只处理单值圆角；多值（如 12px 12px 0 0）逐个替换
    pattern:
      /(border-(?:top-left-|top-right-|bottom-left-|bottom-right-)?radius\s*:\s*)([^;}\n]+)/g,
    map: null,
  },
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(css|vue)$/.test(name) && full !== tokensFile) out.push(full)
  }
  return out
}

/** 返回 [start, end) 区间：.vue 只取 <style> 块，.css 取全文 */
function styleRanges(file, text) {
  if (file.endsWith('.css')) return [[0, text.length]]
  const ranges = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text))) {
    const start = m.index + m[0].indexOf('>') + 1
    ranges.push([start, start + m[1].length])
  }
  return ranges
}

function transformCss(css, report) {
  let out = css.replace(RULES[0].pattern, (all, prop, num) => {
    const token = RULES[0].map(Number(num))
    if (!token) {
      report.push(`font-size: ${num}px`)
      return all
    }
    return `${prop}var(${token})`
  })
  out = out.replace(RULES[1].pattern, (all, prop, value) => {
    if (value.includes('var(') && !/\d+px/.test(value)) return all
    const replaced = value.replace(/(\d+(?:\.\d+)?)px/g, (raw, num) => {
      const token = radiusToken(Number(num))
      if (!token) {
        if (Number(num) !== 0) report.push(`radius: ${raw}`)
        return raw
      }
      return `var(${token})`
    })
    return prop + replaced
  })
  return out
}

/** 去掉 HTML 注释、<script> 和 <style>，只留模板（保持行号不变） */
function templateOnly(text) {
  const blank = m => m.replace(/[^\n]/g, ' ')
  return text
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, blank)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, blank)
}

/** 从 start（指向 '<'）读到标签结束的 '>'，跳过引号里的内容（属性表达式里可能有 '>'） */
function readTag(text, start) {
  let quote = ''
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return text.slice(start, i + 1)
  }
  return text.slice(start)
}

/** 允许保留原生的 <input type>：文件选择、滑块、隐藏字段 */
const NATIVE_INPUT_TYPES = new Set(['file', 'range', 'hidden'])

/** .vue 模板里的原生 <button>，返回行号 */
function rawButtonLines(text) {
  const template = templateOnly(text)
  const lines = []
  const re = /<button[\s>/]/g
  let m
  while ((m = re.exec(template))) {
    lines.push(template.slice(0, m.index).split('\n').length)
  }
  return lines
}

/** .vue 模板里的原生 <input> / <select> / <textarea>，返回 [行号, 标签名] */
function rawFieldLines(text) {
  const template = templateOnly(text)
  const found = []
  const re = /<(input|select|textarea)[\s>/]/g
  let m
  while ((m = re.exec(template))) {
    const tag = m[1]
    if (tag === 'input') {
      const type = /\stype="([^"]*)"/.exec(readTag(template, m.index))?.[1]
      if (type && NATIVE_INPUT_TYPES.has(type)) continue
    }
    found.push([template.slice(0, m.index).split('\n').length, tag])
  }
  return found
}

let dirty = 0
const leftovers = []
const rawControls = []
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.vue') && !file.startsWith(uiDir)) {
    for (const line of rawButtonLines(text))
      rawControls.push(
        `${path.relative(root, file)}:${line}: 手写了 <button>，请改用 components/ui 里的组件`
      )
    for (const [line, tag] of rawFieldLines(text))
      rawControls.push(
        `${path.relative(root, file)}:${line}: 手写了 <${tag}>，请改用 components/ui 里的表单组件`
      )
  }
  const ranges = styleRanges(file, text)
  if (!ranges.length) continue
  let result = ''
  let cursor = 0
  const report = []
  for (const [start, end] of ranges) {
    result +=
      text.slice(cursor, start) + transformCss(text.slice(start, end), report)
    cursor = end
  }
  result += text.slice(cursor)
  const rel = path.relative(root, file)
  if (result !== text) {
    dirty++
    if (fix) writeFileSync(file, result)
    else console.log(`${rel}: 有裸字号或圆角，可运行 --fix`)
  }
  for (const item of report) leftovers.push(`${rel}: ${item}（无对应令牌）`)
}

for (const line of leftovers) console.log(line)
for (const line of rawControls) console.log(line)
if (fix) console.log(`已迁移 ${dirty} 个文件`)
if (rawControls.length) process.exit(1)
if (!fix && (dirty || leftovers.length)) process.exit(1)
if (!fix) console.log('样式令牌检查通过')
