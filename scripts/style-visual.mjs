/**
 * 视觉令牌纪律（由 style-tokens.mjs 调用，计入 scripts/baselines/style-visual.json，只减不增）。
 *
 *   - font-weight：只用 400 / 500 / 600（normal、--font-weight-regular / -medium / -semibold）
 *   - radius：圆角只用 --radius-* 令牌，以及 0、50%
 *   - color：颜色只用令牌；不写 #hex、rgb()/hsl() 等颜色函数，颜色类属性里不写命名颜色
 *   - selected-border：选中态（.active / .selected / [aria-selected] / [aria-current] /
 *     [aria-pressed] / :checked 等）只换填充（--bg-active），不加边框或描边
 *
 * 确有理由的单条声明，在同一行写 `/* style-tokens: visual（原因） *\/` 豁免。
 * tokens.css 是令牌的定义处，不在检查范围（调用方已排除）。
 */
import postcss from 'postcss'

/** 声明所在行带这个注释就跳过视觉检查 */
const VISUAL_EXEMPT = /\/\*\s*style-tokens:\s*visual/

const ALLOWED_WEIGHTS = new Set([
  '400',
  '500',
  '600',
  'normal',
  'inherit',
  'var(--font-weight-regular)',
  'var(--font-weight-medium)',
  'var(--font-weight-semibold)',
])

const RADIUS_PROP =
  /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/
const RADIUS_TOKEN = /var\(--radius-[\w-]+(?:\s*,\s*var\(--radius-[\w-]+\))?\)/g
const RADIUS_KEYWORDS = new Set(['0', '50%', 'inherit', '/'])

const COLOR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i
const COLOR_PROP =
  /^(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|box-shadow|text-shadow|column-rule(?:-color)?)$/
const NAMED_COLOR =
  /\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|cyan|magenta|navy|teal|maroon|olive|lime|aqua|fuchsia)\b/i
/** 这些属性的值不是颜色（字体名、内容文本、名字），不查颜色 */
const NON_COLOR_PROP =
  /^(?:content|font-family|grid-template-areas|grid-area|animation-name|transition-property|will-change|counter-[a-z]+|quotes)$/

const SELECTED =
  /\.(?:active|selected|is-active|is-selected|is-current|current|checked|on)\b|\[aria-(?:selected|current|pressed|checked)(?!=["']?false)|:checked\b/
const BORDER_PROP =
  /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:color|width|style))?|outline(?:-(?:color|width|style))?)$/
const BORDER_OFF =
  /^(?:none|0|transparent|inherit|initial|unset|0 none|none 0)$/

/**
 * 逐条检查一段 CSS 的视觉纪律。
 *
 * @param {string} css 一段 CSS（.css 全文或 .vue 的一个 <style> 块）
 * @param {{ file: string, lineOffset?: number }} where 文件（相对仓库根）与该段起始行前的行数
 * @returns {{ file: string, line: number, rule: string, text: string }[]}
 */
export function visualFindings(css, { file, lineOffset = 0 }) {
  let root
  try {
    root = postcss.parse(css)
  } catch {
    return [] // 语法错误交给构建报，这里不重复
  }
  const lines = css.split('\n')
  const findings = []
  root.walkDecls(decl => {
    const lineNo = decl.source?.start?.line ?? 1
    if (VISUAL_EXEMPT.test(lines[lineNo - 1] ?? '')) return
    const prop = decl.prop.toLowerCase()
    const value = decl.value.trim()
    const add = rule =>
      findings.push({
        file,
        line: lineNo + lineOffset,
        rule,
        text: `${decl.prop}: ${value}`,
      })
    if (prop === 'font-weight' && !ALLOWED_WEIGHTS.has(value))
      add('font-weight')
    if (RADIUS_PROP.test(prop) && !radiusOk(value)) add('radius')
    if (
      !prop.startsWith('--') &&
      !NON_COLOR_PROP.test(prop) &&
      colorLiteral(prop, value)
    )
      add('color')
    else if (prop.startsWith('--') && COLOR_LITERAL.test(value)) add('color')
    if (BORDER_PROP.test(prop) && !BORDER_OFF.test(value) && selectedRule(decl))
      add('selected-border')
  })
  return findings
}

/** 圆角值的每一段都得是 --radius-* 令牌、0 或 50% */
function radiusOk(value) {
  return value
    .replace(RADIUS_TOKEN, ' ')
    .replace(/\//g, ' / ')
    .split(/\s+/)
    .filter(Boolean)
    .every(part => RADIUS_KEYWORDS.has(part))
}

/** 值里有字面颜色（命名颜色只在颜色类属性里算；var() 里的令牌名不算） */
function colorLiteral(prop, value) {
  if (COLOR_LITERAL.test(value)) return true
  if (!COLOR_PROP.test(prop)) return false
  return NAMED_COLOR.test(
    value.replace(/var\([^)]*\)/g, ' ').replace(/url\([^)]*\)/g, ' ')
  )
}

/** 声明所在规则（含嵌套的上层规则）的选择器是否是选中态；焦点样式不算 */
function selectedRule(decl) {
  for (let node = decl.parent; node; node = node.parent) {
    if (node.type !== 'rule') continue
    const selectors = node.selectors ?? [node.selector]
    if (selectors.some(s => SELECTED.test(s) && !/:focus/.test(s))) return true
  }
  return false
}
