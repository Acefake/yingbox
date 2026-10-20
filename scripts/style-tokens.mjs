/**
 * 样式令牌检查与迁移。
 *
 * 渲染进程的样式里，字号和圆角必须引用 tokens.css 的变量，不能写裸 px。
 * 同样受检的还有：
 *   - 间距：padding / margin / gap / inset / top / right / bottom / left 里的裸 px
 *     （0 和 1px 发丝线除外）。确属布局尺寸的偏移，在同一行末尾写
 *     `/* style-tokens: layout（原因） *\/` 豁免。
 *   - 动效：transition / animation 里的字面时长，改用 --duration-*。
 *   - 层级：数字 z-index（0、1、-1、auto 除外），改用 --z-*。
 * --fix 只替换能精确对上令牌的值，就近取档需要人工判断。
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
 * <input> 允许保留原生。模板里也不能写静态 style="..."，请改用类名和令牌
 * （动态 :style 绑定不受限）。这几项 --fix 无法自动修复。
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

/** 间距 px → 令牌（只收精确值） */
const SPACE = new Map([
  [2, '--space-0_5'],
  [4, '--space-1'],
  [8, '--space-2'],
  [12, '--space-3'],
  [16, '--space-4'],
  [20, '--space-5'],
  [24, '--space-6'],
  [28, '--space-6_5'],
  [32, '--space-7'],
  [40, '--space-8'],
  [48, '--space-9'],
  [64, '--space-10'],
  [80, '--space-11'],
])

/** 时长 ms → 令牌（只收精确值） */
const DURATION = new Map([
  [100, '--duration-instant'],
  [150, '--duration-fast'],
  [240, '--duration-normal'],
  [350, '--duration-slow'],
  [800, '--duration-spin'],
  [1400, '--duration-pulse'],
])

/** z-index 数值 → 令牌（只收精确值） */
const Z_INDEX = new Map([
  [2, '--z-raised'],
  [5, '--z-above'],
  [10, '--z-float'],
  [20, '--z-dropdown'],
  [30, '--z-popover'],
  [40, '--z-overlay'],
  [45, '--z-overlay-top'],
  [1100, '--z-bottom-nav'],
  [1140, '--z-drawer-backdrop'],
  [1150, '--z-drawer'],
  [2000, '--z-modal'],
  [2050, '--z-sheet'],
  [2060, '--z-lightbox'],
  [2100, '--z-settings'],
  [3000, '--z-dialog'],
  [6000, '--z-player-overlay'],
  [10000, '--z-max'],
])

/** 声明后紧跟这个注释（同一行）的是布局尺寸，跳过间距检查 */
const LAYOUT_EXEMPT = /\/\*\s*style-tokens:\s*layout/

const SPACING_DECL =
  /(^|[;{\s])((?:padding|margin|inset)(?:-(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap|top|right|bottom|left)(\s*:\s*)([^;}\n]+)(?=(;?[ \t]*(?:\/\*[^*]*\*\/)?))/g
const MOTION_DECL =
  /(^|[;{\s])((?:transition|animation)(?:-duration|-delay)?)(\s*:\s*)([^;}]+)/g
const Z_DECL = /(^|[;{\s])(z-index\s*:\s*)(-?\d+)(?=\s*[;}\n])/g

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
  out = out.replace(SPACING_DECL, (all, pre, prop, colon, value, rest) => {
    if (LAYOUT_EXEMPT.test(rest)) return all
    const replaced = value.replace(
      /(-?)(\d+(?:\.\d+)?)px/g,
      (raw, neg, num) => {
        const px = Number(num)
        if (px <= 1) return raw
        const token = SPACE.get(px)
        if (!token) {
          report.push(`${prop}: ${raw}`)
          return raw
        }
        return neg ? `calc(var(${token}) * -1)` : `var(${token})`
      }
    )
    return pre + prop + colon + replaced
  })
  out = out.replace(MOTION_DECL, (all, pre, prop, colon, value) => {
    const replaced = value.replace(
      /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g,
      (raw, num, unit) => {
        const ms = unit === 's' ? Number(num) * 1000 : Number(num)
        // 0 与 prefers-reduced-motion 里的 0.01ms 是“关掉动画”，不算动效档位
        if (ms <= 0.01) return raw
        const token = DURATION.get(ms)
        if (!token) {
          report.push(`${prop}: ${raw}`)
          return raw
        }
        return `var(${token})`
      }
    )
    return pre + prop + colon + replaced
  })
  out = out.replace(Z_DECL, (all, pre, prop, num) => {
    const n = Number(num)
    if (n >= -1 && n <= 1) return all
    const token = Z_INDEX.get(n)
    if (!token) {
      report.push(`z-index: ${num}`)
      return all
    }
    return `${pre}${prop}var(${token})`
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

/** .vue 模板里的静态 style="..." 属性（不含 :style / v-bind:style），返回行号 */
function inlineStyleLines(text) {
  const template = templateOnly(text)
  const lines = []
  const re = /[\s]style="/g
  let m
  while ((m = re.exec(template))) {
    lines.push(template.slice(0, m.index + 1).split('\n').length)
  }
  return lines
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
    for (const line of inlineStyleLines(text))
      rawControls.push(
        `${path.relative(root, file)}:${line}: 写了行内 style，请改用类名和令牌`
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
    else console.log(`${rel}: 有可映射到令牌的裸值，可运行 --fix`)
  }
  for (const item of report) leftovers.push(`${rel}: ${item}（无对应令牌）`)
}

for (const line of leftovers) console.log(line)
for (const line of rawControls) console.log(line)
if (fix) console.log(`已迁移 ${dirty} 个文件`)
if (rawControls.length) process.exit(1)
if (!fix && (dirty || leftovers.length)) process.exit(1)
if (!fix) console.log('样式令牌检查通过')
