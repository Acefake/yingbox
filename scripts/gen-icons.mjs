/**
 * 生成 src/renderer/src/components/ui/icons.ts：从 @phosphor-icons/core（MIT）取图标路径，内联成字符串。
 *
 * 只打包这里列出的图标和字重，运行时不依赖图标库。改图标：编辑下面的 ICONS 表，再运行
 *
 *   node scripts/gen-icons.mjs          重新生成 icons.ts
 *   node scripts/gen-icons.mjs --check  只比对，icons.ts 与表不一致时退出码为 1
 *
 * 字重约定：导航、按钮、状态图标用 fill；箭头、窗口键、搜索、关闭这类细小控件用 bold。
 * 切换型图标（收藏、评分、书签）未选中用 bold 描边、选中用 fill，两种字重都要打包。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(root, 'src/renderer/src/components/ui/icons.ts')
const require = createRequire(import.meta.url)
/** 包的 exports 只开放 svg 子路径，按其中一个文件定位 assets 目录 */
const assets = path.resolve(
  path.dirname(
    require.resolve('@phosphor-icons/core/assets/fill/house-fill.svg')
  ),
  '..'
)

/** 应用图标名 → [Phosphor 图标名, 默认字重, 另外打包的字重] */
const ICONS = {
  // 导航与页面
  home: ['house', 'fill'],
  history: ['clock-counter-clockwise', 'fill'],
  heart: ['heart', 'bold', ['fill']],
  calendar: ['calendar-dots', 'fill'],
  movie: ['film-strip', 'fill'],
  tv: ['television-simple', 'fill'],
  av: ['film-reel', 'fill'],
  globe: ['globe', 'fill'],
  database: ['database', 'fill'],
  settings: ['gear-six', 'fill'],
  panel: ['sidebar-simple', 'fill'],
  // 媒体与播放
  play: ['play', 'fill'],
  livePlay: ['play-circle', 'fill'],
  pause: ['pause', 'fill'],
  stop: ['stop', 'fill'],
  skipForward: ['skip-forward', 'fill'],
  volume: ['speaker-high', 'fill'],
  volumeOff: ['speaker-x', 'fill'],
  subtitle: ['subtitles', 'fill'],
  pip: ['picture-in-picture', 'fill'],
  fullscreen: ['corners-out', 'bold'],
  exitFullscreen: ['corners-in', 'bold'],
  range: ['arrows-out-line-horizontal', 'bold'],
  mic: ['microphone', 'fill'],
  // 内容与文件
  star: ['star', 'bold', ['fill']],
  bookmark: ['bookmark-simple', 'bold', ['fill']],
  folder: ['folder-simple', 'fill'],
  file: ['file-text', 'fill'],
  image: ['image', 'fill'],
  tag: ['tag', 'fill'],
  download: ['download-simple', 'fill'],
  trash: ['trash', 'fill'],
  save: ['floppy-disk', 'fill'],
  copy: ['copy', 'fill'],
  edit: ['pencil-simple', 'fill'],
  lock: ['lock', 'fill'],
  pin: ['push-pin', 'fill'],
  send: ['paper-plane-tilt', 'fill'],
  sparkle: ['sparkle', 'fill'],
  wand: ['magic-wand', 'fill'],
  clock: ['clock', 'fill'],
  eye: ['eye', 'fill'],
  eyeOff: ['eye-slash', 'fill'],
  info: ['info', 'fill'],
  warning: ['warning', 'fill'],
  sun: ['sun', 'fill'],
  moon: ['moon', 'fill'],
  filter: ['funnel', 'fill'],
  grid: ['squares-four', 'fill'],
  // 细小控件
  back: ['caret-left', 'bold'],
  forward: ['caret-right', 'bold'],
  chevronDown: ['caret-down', 'bold'],
  chevronUp: ['caret-up', 'bold'],
  arrowUp: ['arrow-up', 'bold'],
  arrowDown: ['arrow-down', 'bold'],
  close: ['x', 'bold'],
  check: ['check', 'bold'],
  plus: ['plus', 'bold'],
  search: ['magnifying-glass', 'bold'],
  more: ['dots-three', 'bold'],
  menu: ['list', 'bold'],
  list: ['list-bullets', 'bold'],
  sort: ['arrows-down-up', 'bold'],
  refresh: ['arrow-clockwise', 'bold'],
  link: ['link', 'bold'],
  externalLink: ['arrow-square-out', 'bold'],
  scan: ['scan', 'bold'],
  // 窗口键
  minimize: ['minus', 'bold'],
  maximize: ['square', 'bold'],
  restore: ['copy-simple', 'bold'],
}

/** 读一个 Phosphor SVG，多段 <path> 合成一条 d（同色实心填充，合并后画面不变） */
function pathOf(name, weight) {
  const file = path.join(assets, weight, `${name}-${weight}.svg`)
  const svg = readFileSync(file, 'utf8')
  if (!svg.includes('viewBox="0 0 256 256"'))
    throw new Error(`${file}: viewBox 不是 0 0 256 256`)
  const body = svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
  const paths = [...body.matchAll(/<path d="([^"]+)"\/>/g)].map(m => m[1])
  if (!paths.length || body.replace(/<path d="[^"]+"\/>/g, '').trim())
    throw new Error(`${file}: 只支持纯 <path> 的图标`)
  return paths.join('')
}

function render() {
  const lines = []
  for (const [app, [name, weight, extra = []]] of Object.entries(ICONS)) {
    const entries = [weight, ...extra]
      .map(w => `${w}: '${pathOf(name, w)}'`)
      .join(', ')
    lines.push(`  ${app}: { weight: '${weight}', ${entries} },`)
  }
  return `/**
 * 统一图标：Phosphor Icons（MIT，https://phosphoricons.com），256×256 视框，实心路径。
 * 由 scripts/gen-icons.mjs 生成，不要手改；增删图标改脚本里的表再重新生成。
 *
 * 每个图标有默认字重：导航、按钮用 fill，细小控件（箭头、窗口键、搜索、关闭）用 bold；
 * 收藏 / 评分 / 书签另带 fill，选中时用。
 */
export type IconWeight = 'fill' | 'bold'

/** 一个图标：默认字重和各字重的路径 */
export type IconDef = { weight: IconWeight } & Partial<Record<IconWeight, string>>

export const ICONS = {
${lines.join('\n')}
} as const satisfies Record<string, IconDef>

export type IconName = keyof typeof ICONS

/**
 * 图标路径：要的字重没打包时退回默认字重。
 * @param name 图标名
 * @param weight 字重；不传用图标的默认字重
 */
export function iconPath(name: IconName, weight?: IconWeight): string {
  const icon: IconDef = ICONS[name]
  return icon[weight ?? icon.weight] ?? icon[icon.weight] ?? ''
}
`
}

const next = await format(render(), {
  ...(await resolveConfig(outFile)),
  filepath: outFile,
})
if (process.argv.includes('--check')) {
  const current = readFileSync(outFile, 'utf8')
  if (current !== next) {
    console.error(
      'icons.ts 与 scripts/gen-icons.mjs 的表不一致，运行 node scripts/gen-icons.mjs'
    )
    process.exit(1)
  }
  console.log('icons.ts 与生成结果一致')
} else {
  writeFileSync(outFile, next)
  console.log(
    `写入 ${path.relative(root, outFile)}：${Object.keys(ICONS).length} 个图标`
  )
}
