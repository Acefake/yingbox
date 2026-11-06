/**
 * 安卓开发构建用的 Node：从 Termux 软件源取 Node 及其动态库，放进 jniLibs（ADR-0034 决策 3）。
 *
 * 自己编译的 Node（静态链接）出来之前顶替用，只用于开发和模拟器验证，不发布。
 * jniLibs 只打包 lib*.so，带版本号的库（libssl.so.3）去掉版本号打包，
 * 原名和打包名写进 assets/node/libs.txt，应用启动时在私有目录建同名符号链接。
 *
 *   node scripts/android/termux-node.mjs [--abi x86_64,arm64-v8a]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDynamic } from './elf.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const APP = join(ROOT, 'android/app/src/main')
const CACHE = join(ROOT, 'android/.cache/termux')
const REPO = 'https://packages.termux.dev/apt/termux-main/'
const ARCH = { 'arm64-v8a': 'aarch64', 'armeabi-v7a': 'arm', x86_64: 'x86_64' }
/** 系统自带、不打包的库。 */
const SYSTEM = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so'])
const PREFIX = 'data/data/com.termux/files/usr'

/** 解析 Debian Packages 索引。 */
function parseIndex(text) {
  const packages = new Map()

  for (const block of text.split(/\n\n+/)) {
    const fields = Object.fromEntries(
      block
        .split('\n')
        .filter(line => /^[\w-]+:/.test(line))
        .map(line => [
          line.slice(0, line.indexOf(':')),
          line.slice(line.indexOf(':') + 1).trim(),
        ])
    )

    if (fields.Package) packages.set(fields.Package, fields)
  }
  return packages
}

/** 从 nodejs 出发收集依赖包。 */
function closure(index) {
  const seen = new Set()
  const stack = ['nodejs']

  while (stack.length) {
    const name = stack.pop()
    if (seen.has(name) || !index.has(name)) continue
    seen.add(name)
    for (const dep of (index.get(name).Depends ?? '').split(','))
      stack.push(dep.trim().split(/[\s(|]/)[0])
  }
  return [...seen].map(name => index.get(name))
}

/** 从 .deb（ar 归档）里取出 data.tar.*。 */
function debData(buf) {
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n')
    throw new Error('不是 deb 文件')
  for (let at = 8; at < buf.length; ) {
    const name = buf
      .toString('latin1', at, at + 16)
      .trim()
      .replace(/\/$/, '')
    const size = Number(buf.toString('latin1', at + 48, at + 58).trim())
    const body = buf.subarray(at + 60, at + 60 + size)

    if (name.startsWith('data.tar')) return { name, body }
    at += 60 + size + (size % 2)
  }
  throw new Error('deb 里没有 data.tar')
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/** 下载并按索引里的 SHA256 校验；缓存命中也校验，对不上就重新下载。 */
async function download(url, file, expected) {
  if (existsSync(file)) {
    const cached = readFileSync(file)
    if (sha256(cached) === expected) return cached
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256(buf) !== expected) throw new Error(`SHA256 不符：${url}`)
  writeFileSync(file, buf)
  return buf
}

/** 解开 data.tar.*。包里的符号链接在 Windows 上可能建不出来，只容忍这一类失败：后面只认真实文件，靠 SONAME 找库。 */
function untar(dir, name) {
  // 用相对路径：GNU tar 会把 D:\ 这类盘符当成远程主机
  const result = spawnSync('tar', ['-xf', name, '-C', 'root'], {
    cwd: dir,
    encoding: 'utf8',
  })
  if (result.error) throw new Error(`运行 tar 失败：${result.error.message}`)
  if (result.status === 0) return
  const errors = result.stderr
    .split('\n')
    .filter(
      line =>
        line.trim() &&
        !/symlink|symbolic link|Exiting with failure status/i.test(line)
    )
  if (errors.length)
    throw new Error(`tar 解包 ${name} 失败：\n${errors.join('\n')}`)
}

/** 下载并解开一个 ABI 的全部包，返回解开后的 usr 目录。 */
async function fetchArch(arch) {
  const dir = join(CACHE, arch)
  const root = join(dir, 'root')
  mkdirSync(dir, { recursive: true })
  const res = await fetch(`${REPO}dists/stable/main/binary-${arch}/Packages`)
  if (!res.ok) throw new Error(`取索引失败 ${res.status}`)
  const pkgs = closure(parseIndex(await res.text()))
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })

  for (const pkg of pkgs) {
    const deb = await download(
      REPO + pkg.Filename.replaceAll(':', '%3A'),
      join(dir, basename(pkg.Filename).replaceAll(':', '_')),
      pkg.SHA256
    )
    const data = debData(deb)
    writeFileSync(join(dir, data.name), data.body)
    untar(dir, data.name)
    console.log(`  ${pkg.Package} ${pkg.Version}`)
  }
  const usr = join(root, PREFIX)
  if (!existsSync(join(usr, 'bin/node')))
    throw new Error(`解包后没有 ${PREFIX}/bin/node`)
  return usr
}

/** 打包名：只保留 lib<名>.so。 */
const packagedName = needed => needed.replace(/\.so(\.\d+)+$/, '.so')

/** 从 node 出发找齐动态库，拷进 jniLibs/<abi>，返回「原名 → 打包名」。 */
function collect(usr, out) {
  const libDir = join(usr, 'lib')
  const files = readdirSync(libDir).filter(
    name => /\.so(\.|$)/.test(name) && statSync(join(libDir, name)).isFile()
  )
  const bySoname = new Map()

  for (const name of files) {
    const soname = readDynamic(readFileSync(join(libDir, name)))?.soname
    if (soname && !bySoname.has(soname)) bySoname.set(soname, name)
  }
  const resolve = needed =>
    bySoname.get(needed) ??
    files.find(name => name === needed) ??
    files.find(name => name.startsWith(`${needed}.`))
  const links = new Map()
  const packaged = new Map()
  const queue = [...readDynamic(readFileSync(join(usr, 'bin/node'))).needed]

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  copyFileSync(join(usr, 'bin/node'), join(out, 'libnode.so'))
  while (queue.length) {
    const needed = queue.shift()
    if (SYSTEM.has(needed) || links.has(needed)) continue
    const file = resolve(needed)
    if (!file) throw new Error(`找不到依赖库 ${needed}`)
    const name = packagedName(needed)
    if (packaged.has(name) && packaged.get(name) !== file)
      throw new Error(`打包名冲突：${name}`)
    packaged.set(name, file)
    links.set(needed, name)
    copyFileSync(join(libDir, file), join(out, name))
    queue.push(...readDynamic(readFileSync(join(libDir, file))).needed)
  }
  return links
}

async function main() {
  const abiArg = process.argv.indexOf('--abi')
  const abis =
    abiArg >= 0 ? process.argv[abiArg + 1].split(',') : ['x86_64', 'arm64-v8a']
  let manifest = null

  for (const abi of abis) {
    if (!ARCH[abi])
      throw new Error(
        `不支持的 ABI：${abi}（可选 ${Object.keys(ARCH).join('、')}）`
      )
    console.log(`[${abi}] Termux ${ARCH[abi]}`)
    const links = collect(await fetchArch(ARCH[abi]), join(APP, 'jniLibs', abi))
    const text = [...links]
      .filter(([from, to]) => from !== to)
      .map(([from, to]) => `${from} ${to}`)
      .sort()
      .join('\n')
    if (manifest !== null && manifest !== text)
      throw new Error('各 ABI 的库名清单不一致')
    manifest = text
    console.log(
      `[${abi}] ${links.size + 1} 个文件 → android/app/src/main/jniLibs/${abi}`
    )
  }
  mkdirSync(join(APP, 'assets/node'), { recursive: true })
  writeFileSync(join(APP, 'assets/node/libs.txt'), `${manifest}\n`)
}

await main()
