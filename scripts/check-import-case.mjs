// 检查源码中 import 路径的大小写与磁盘是否一致。
// 背景：Windows 文件系统不区分大小写，写错大小写的 import 在本地能跑，
// 但 mac/Linux 构建会报 TS1149 / Vite 解析失败。用 tsc 拦不住（Windows 下不报错），
// 所以用本脚本逐段比对磁盘真实名称，在 CI（或提交前）提前拦截。
// 用法：node scripts/check-import-case.mjs
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 纯 JS 运维脚本，无 TS 返回值注解 */
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDirs = [join(root, 'src')]
const alias = { '@/': join(root, 'src', 'renderer', 'src') + '/' }
const exts = ['.ts', '.tsx', '.vue', '.js', '.mjs', '.json', '']
const importRe =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const failures = []

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules') continue
      listFiles(p, out)
    } else if (/\.(ts|vue|js|mjs)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

// 逐段校验：每一级目录/文件名都必须与磁盘真实大小写完全一致
function checkCase(absPath) {
  const parts = absPath.split(/[/\\]/)
  // 找到盘符/根起点
  let cur = parts[0].endsWith(':') ? parts[0] + '/' : '/'
  const rest = parts[0].endsWith(':') ? parts.slice(1) : parts.slice(1)
  for (const seg of rest) {
    if (!seg) continue
    let entries
    try {
      entries = readdirSync(cur)
    } catch {
      return null // 路径不存在（如外部包），跳过
    }
    const hit = entries.find(e => e.toLowerCase() === seg.toLowerCase())
    if (!hit) return null // 找不到：可能是省略扩展名的情况，由调用方补扩展名
    if (hit !== seg) return `${cur}${seg}（磁盘实际为 ${hit}）`
    cur = join(cur, seg) + '/'
  }
  return null
}

function resolveImport(spec, fromFile) {
  let base = spec
  for (const [k, v] of Object.entries(alias)) {
    if (spec.startsWith(k)) base = v + spec.slice(k.length)
  }
  if (
    !base.startsWith('.') &&
    !base.startsWith('/') &&
    !Object.values(alias).some(v => base.startsWith(v))
  ) {
    return null // 第三方包，跳过
  }
  const abs = base.startsWith('.') ? resolve(dirname(fromFile), base) : base
  const candidates = exts
    .map(e => abs + e)
    .concat(exts.filter(Boolean).map(e => join(abs, 'index' + e)))
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c
    } catch {
      /* try next */
    }
  }
  return abs // 保留原始路径用于报错定位
}

for (const dir of srcDirs) {
  for (const file of listFiles(dir)) {
    const text = (await import('node:fs')).readFileSync(file, 'utf-8')
    let m
    importRe.lastIndex = 0
    while ((m = importRe.exec(text))) {
      const spec = m[1] ?? m[2]
      if (!spec || (spec.startsWith('.') === false && !spec.startsWith('@/')))
        continue
      const target = resolveImport(spec, file)
      if (!target) continue
      const bad = checkCase(target)
      if (bad) failures.push(`${file} -> '${spec}': ${bad}`)
    }
  }
}

if (failures.length) {
  console.error(`发现 ${failures.length} 处 import 大小写与磁盘不一致：`)
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('import 大小写检查通过')
