/**
 * 打包后校验 app.asar 是否完好。
 *
 * 背景：曾出现过 asar 头部记录的 size/offset 与实际写入数据不一致的情况
 * （打包时文件正被 OneDrive/编辑器改写，读到的字节数少于记录值），
 * 结果是 package.json 读出来不是合法 JSON，Electron 加载主进程直接静默失败
 * （退出码 1、无任何日志）。这个脚本让这种问题在打包阶段就暴露。
 *
 * 用法：node scripts/verify-asar.mjs [asarPath]
 *   asarPath 默认 dist/win-unpacked/resources/app.asar
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function defaultAsar() {
  const dir = path.join(ROOT, 'dist')
  if (!existsSync(dir))
    return path.join(dir, 'win-unpacked', 'resources', 'app.asar')
  const unpacked = readdirSync(dir).find(n => n.endsWith('unpacked'))
  return path.join(dir, unpacked || 'win-unpacked', 'resources', 'app.asar')
}

/** 解析 asar 头部，返回 { raw, header, dataOffset }
 *  文件布局：[uint32=4][uint32 headerSize][uint32 strLen][JSON...][padding][file data]
 */
function readHeader(file) {
  const raw = readFileSync(file)
  if (raw.readUInt32LE(0) !== 4)
    throw new Error('不是合法的 asar（首个 uint32 应为 4）')
  const headerSize = raw.readUInt32LE(4)
  const jsonLen = raw.readUInt32LE(12)
  const header = JSON.parse(raw.toString('utf8', 16, 16 + jsonLen))
  return { raw, header, dataOffset: 8 + headerSize }
}

/** 收集所有文件条目：路径 -> { offset, size } */
function collect(header) {
  const out = new Map()
  const walk = (node, prefix) => {
    for (const [name, val] of Object.entries(node.files || {})) {
      const p = `${prefix}/${name}`
      if (val.files) walk(val, p)
      else out.set(p, { offset: Number(val.offset), size: val.size })
    }
  }
  walk(header, '')
  return out
}

const file = process.argv[2] || defaultAsar()
if (!existsSync(file)) {
  console.error(`[verify-asar] 找不到 ${path.relative(ROOT, file)}`)
  process.exit(1)
}
const { raw, header, dataOffset } = readHeader(file)
const entries = collect(header)
const read = p => {
  const e = entries.get(p)
  if (!e) return null
  return raw.subarray(dataOffset + e.offset, dataOffset + e.offset + e.size)
}

const problems = []
const totalBytes = statSync(file).size

// 1) package.json 必须是合法 JSON，且 main 指向的文件存在
const pkgRaw = read('/package.json')
if (!pkgRaw) {
  problems.push('asar 内缺少 /package.json')
} else {
  const text = pkgRaw.toString('utf8')
  let pkg = null
  try {
    pkg = JSON.parse(text)
  } catch (error) {
    problems.push(
      `/package.json 不是合法 JSON（${error.message}）；开头 80 字节：${JSON.stringify(text.slice(0, 80))}`
    )
  }
  if (pkg) {
    const main = String(pkg.main || '').replace(/^\.?\//, '/')
    if (!entries.has(main))
      problems.push(`package.json 的 main 指向的 ${main} 不在 asar 中`)
    else if (read(main).subarray(0, 2).toString('latin1') === '')
      problems.push(`${main} 为空`)
  }
}

// 2) 主进程/预加载/渲染入口可读取且非空
for (const p of [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
]) {
  const e = entries.get(p)
  if (!e) problems.push(`缺少 ${p}`)
  else if (!e.size) problems.push(`${p} 大小为 0`)
  else if (dataOffset + e.offset + e.size > totalBytes)
    problems.push(`${p} 数据越界（asar 被截断）`)
}

// 3) 数据区不能越界
const maxEnd = Math.max(
  ...[...entries.values()].map(e => dataOffset + e.offset + e.size)
)
if (maxEnd > totalBytes)
  problems.push(
    `数据区越界：需要 ${maxEnd} 字节，文件只有 ${totalBytes} 字节（asar 损坏）`
  )

console.log(
  `[verify-asar] ${path.relative(ROOT, file)}  ${(totalBytes / 1048576).toFixed(1)} MB，${entries.size} 个条目`
)
if (problems.length) {
  for (const p of problems) console.error(`[verify-asar] ✗ ${p}`)
  process.exit(1)
}
console.log(
  '[verify-asar] ✓ app.asar 完好（package.json 可解析、main/入口齐全、数据区完整）'
)
