/**
 * 一次性迁移：AppIcon / IconButton / ActionButton → components/ui 下的 UiIcon / UiIconButton / UiButton。
 * 可重复运行（已迁移的文件不会再变）。
 *
 *   node scripts/codemods/rename-ui-components.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const srcDir = path.join(root, 'src/renderer/src')
const uiDir = path.join(srcDir, 'components/ui')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|ts)$/.test(name)) out.push(full)
  }
  return out
}

const RENAMES = [
  ['AppIcon', 'UiIcon'],
  ['IconButton', 'UiIconButton'],
  ['ActionButton', 'UiButton'],
]

let changed = 0
for (const file of walk(srcDir)) {
  if (file.startsWith(uiDir)) continue
  const before = readFileSync(file, 'utf8')
  let text = before

  // 图标名类型：InstanceType<typeof AppIcon>['$props']['name'] → IconName
  if (text.includes("InstanceType<typeof AppIcon>['$props']['name']")) {
    text = text
      .replace(/import type AppIcon from '[^']+'\n/, "import type { IconName } from '@/components/ui/icons'\n")
      .replaceAll("InstanceType<typeof AppIcon>['$props']['name']", 'IconName')
  }

  for (const [from, to] of RENAMES) {
    text = text.replace(
      new RegExp(`import ${from} from '(?:@/components/|\\.\\.?/(?:\\.\\./)*)(?:components/)?${from}\\.vue'`, 'g'),
      `import ${to} from '@/components/ui/${to}.vue'`
    )
    text = text.replace(new RegExp(`<(/?)${from}(?=[\\s>/])`, 'g'), `<$1${to}`)
  }

  // ActionButton 的 primary 布尔属性 → variant="primary"
  text = text.replace(/(<UiButton\b[^>]*?)\sprimary(?=[\s/>])/g, '$1 variant="primary"')

  if (text !== before) {
    writeFileSync(file, text)
    changed++
    console.log(path.relative(root, file))
  }
}
console.log(`共修改 ${changed} 个文件`)
