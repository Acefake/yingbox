/**
 * 准备便携版 mpv 运行时（Windows）。
 *
 * 影盒的 mpv 播放引擎需要一个 mpv 可执行文件。优先使用随项目附带的便携版：
 *   源码目录  resources/mpv/mpv.exe            （开发运行）
 *   打包产物  <resourcesPath>/mpv/mpv.exe      （electron-builder extraResources）
 * 两者都找不到时才会退回系统 PATH 中的 mpv；YINGBOX_MPV_PATH 可覆盖。
 *
 * 用法：
 *   node scripts/fetch-mpv.mjs            # 缺失时下载并解压
 *   node scripts/fetch-mpv.mjs --force    # 强制重新下载
 *
 * 来源：shinchiro/mpv-winbuild-cmake（社区标准 Windows 构建）
 * 许可证：mpv 为 GPLv2+，见 https://github.com/mpv-player/mpv/blob/master/Copyright
 * 该目录已被 .gitignore 忽略，不进入版本库。
 */
import { spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.join(ROOT, 'resources', 'mpv')

/** 固定版本，保证构建可复现 */
const RELEASE = '20261015'
const ARCHIVE = `mpv-x86_64-${RELEASE}-git-492bae0768.7z`
const URL = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/${RELEASE}/${ARCHIVE}`

/** 解压后仅保留运行时所需内容 */
const PRUNE = [
  'doc',
  'installer',
  'mpv-register.bat',
  'mpv-unregister.bat',
  'updater.bat',
]

const log = (...a) => console.log('[fetch:mpv]', ...a)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  return r.status ?? 0
}

function canRun(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' })
  return !r.error
}

/** 找到可解压 .7z 的工具及其参数构造方式 */
function findExtractor() {
  const systemTar = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'System32',
    'tar.exe'
  )
  if (
    process.platform === 'win32' &&
    existsSync(systemTar) &&
    canRun(systemTar, ['--version'])
  ) {
    return {
      cmd: systemTar,
      extract: (archive, dest) => [
        ['-xf', archive, '-C', dest],
        { cwd: undefined },
      ],
    }
  }
  for (const sevenZip of ['7z', '7za']) {
    if (canRun(sevenZip, ['i'])) {
      return {
        cmd: sevenZip,
        extract: (archive, dest) => [
          ['x', '-y', `-o${dest}`, archive],
          { cwd: undefined },
        ],
      }
    }
  }
  return null
}

async function download(url, file) {
  log('下载', url)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  log('已保存', `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`)
}

async function main() {
  const force = process.argv.includes('--force')
  const exe = path.join(DEST, 'mpv.exe')

  if (process.platform !== 'win32') {
    log(
      '非 Windows 平台跳过：请使用系统 mpv（macOS: brew install mpv / Linux: sudo apt install mpv）'
    )
    return
  }
  if (existsSync(exe) && !force) {
    log('便携版已存在，跳过：', path.relative(ROOT, exe))
    return
  }

  const extractor = findExtractor()
  if (!extractor)
    throw new Error(
      '找不到可解压 .7z 的工具（需要 Windows 自带 tar.exe，或 7z/7za）'
    )

  const archive = path.join(tmpdir(), ARCHIVE)
  await download(URL, archive)

  log('解压到', path.relative(ROOT, DEST))
  rmSync(DEST, { recursive: true, force: true })
  mkdirSync(DEST, { recursive: true })
  const [args, opts] = extractor.extract(archive, DEST)
  if (run(extractor.cmd, args, opts) !== 0) throw new Error('解压失败')

  for (const item of PRUNE)
    rmSync(path.join(DEST, item), { recursive: true, force: true })
  if (!existsSync(exe)) throw new Error('解压后未找到 mpv.exe')

  const probe = spawnSync(exe, ['--version'], { encoding: 'utf8' })
  log('就绪：', (probe.stdout || '').split('\n')[0] || 'mpv.exe')
}

await main()
