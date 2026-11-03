/**
 * 安卓构建（pnpm build:android，ADR-0028 / ADR-0034）：
 * 1. 构建并整理服务端（同 package:server），在整理目录里装运行依赖（不含可选的 onnxruntime-node）；
 * 2. jniLibs 里缺哪个 ABI 的 Node，就用 Termux 的 Node 补上（scripts/android/termux-node.mjs，默认 x86_64、arm64-v8a）；
 * 3. gradle 打 debug 包，服务端目录由 gradle 压成 assets/server.zip。
 *
 *   node scripts/build-android.mjs [--abi x86_64,arm64-v8a]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageServerPackage } from './package-server.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID = join(ROOT, 'android')
const isWin = process.platform === 'win32'

/** 运行命令；Windows 下 npm、gradlew.bat 经 cmd 启动，命令为固定字符串。 */
function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`)
  if (isWin)
    execFileSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', [command, ...args].join(' ')],
      {
        cwd,
        stdio: 'inherit',
      }
    )
  else execFileSync(command, args, { cwd, stdio: 'inherit' })
}

const abiIndex = process.argv.indexOf('--abi')
const abis =
  abiIndex >= 0
    ? process.argv[abiIndex + 1].split(',')
    : ['x86_64', 'arm64-v8a']
const jniLibs = join(ANDROID, 'app/src/main/jniLibs')
const missing = abis.filter(
  abi => !existsSync(join(jniLibs, abi, 'libnode.so'))
)

run('npm', ['run', 'build:server'], ROOT)
const server = await stageServerPackage(ROOT)
run(
  'npm',
  [
    'install',
    '--omit=dev',
    '--omit=optional',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ],
  server
)
// 指定了 --abi 就重新取；否则只补缺的 ABI
const fetchAbis = abiIndex >= 0 ? abis : missing
if (fetchAbis.length)
  execFileSync(
    process.execPath,
    [
      join(ROOT, 'scripts/android/termux-node.mjs'),
      '--abi',
      fetchAbis.join(','),
    ],
    { stdio: 'inherit' }
  )
const release = process.argv.includes('--release')
run(
  isWin ? '.\\gradlew.bat' : './gradlew',
  release ? [':app:assembleRelease', '-PsplitAbi'] : [':app:assembleDebug'],
  ANDROID
)
console.log(
  `APK：${join(ANDROID, release ? 'app/build/outputs/apk/release' : 'app/build/outputs/apk/debug/app-debug.apk')}`
)
