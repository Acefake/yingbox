/** 安卓发布构建（ADR-0038）：构建、校验签名和版本、生成摘要。本机验证与发布工作流共用，上传由工作流完成。 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
if (process.argv.length > 2)
  throw new Error('用法：node scripts/android-release.mjs')
const version = /^versionName=(\d+\.\d+\.\d+)\s*$/m.exec(
  readFileSync(join(root, 'android/version.properties'), 'utf8')
)?.[1]
if (!version)
  throw new Error('android/version.properties 缺少 versionName=x.y.z')
const [major, minor, patch] = version.split('.').map(Number)
if (
  major > 214747 ||
  minor > 99 ||
  patch > 99 ||
  ![major, minor, patch].every(Number.isSafeInteger)
)
  throw new Error('版本号超出 versionCode 范围')
const versionCode = major * 10000 + minor * 100 + patch
if (versionCode <= 0) throw new Error('发布版本码必须大于 0')
const head = run('git', ['rev-parse', 'HEAD']).trim()
if (!existsSync(join(root, 'android/keystore.properties')))
  throw new Error('缺少发布签名 android/keystore.properties')

const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(homedir(), 'AppData/Local/Android/Sdk')
const buildVersion = readdirSync(join(sdk, 'build-tools'))
  .filter(name => /^\d+\.\d+\.\d+$/.test(name))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
if (!buildVersion) throw new Error('没有 Android SDK build-tools')
const buildTools = join(sdk, 'build-tools', buildVersion)
const jbr =
  process.env.JAVA_HOME ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Android/Android Studio/jbr'
    : '')
const java = jbr
  ? join(jbr, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java'
run(process.execPath, ['scripts/build-android.mjs', '--release'], {
  stdio: 'inherit',
  env: { ...process.env, ...(jbr ? { JAVA_HOME: jbr } : {}) },
})

const destination = join(root, 'out/android-release', version)
mkdirSync(destination, { recursive: true })
let certificate = ''
const expectedCertificate = readFileSync(
  join(root, 'android/release-certificate.sha256'),
  'utf8'
)
  .trim()
  .toLowerCase()
if (!/^[a-f0-9]{64}$/.test(expectedCertificate))
  throw new Error('发布证书指纹无效')
for (const abi of ['arm64-v8a']) {
  const apk = join(
    root,
    'android/app/build/outputs/apk/release',
    `app-${abi}-release.apk`
  )
  const signature = run(java, [
    '-jar',
    join(buildTools, 'lib/apksigner.jar'),
    'verify',
    '--verbose',
    '--print-certs',
    apk,
  ])
  const digest = /certificate SHA-256 digest: ([a-f0-9]+)/i.exec(signature)?.[1]
  if (
    !digest ||
    digest !== expectedCertificate ||
    (certificate && certificate !== digest)
  )
    throw new Error('APK 未签名或两个 ABI 签名不同')
  certificate = digest
  const metadata = run(
    join(buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'),
    ['dump', 'badging', apk]
  )
  if (
    !metadata.includes("name='com.yingbox.android'") ||
    !metadata.includes(`versionName='${version}'`) ||
    !metadata.includes(`versionCode='${versionCode}'`) ||
    !metadata.includes(`native-code: '${abi}'`)
  )
    throw new Error(`APK 的包名、版本或 ABI 不匹配：${abi}`)
  const name = `yingbox-android-${version}-${abi}.apk`
  const target = join(destination, name)
  copyFileSync(apk, target)
}
writeFileSync(
  join(destination, 'build.json'),
  JSON.stringify(
    { version, versionCode, commit: head, certificateSha256: certificate },
    null,
    2
  )
)
console.log(`已校验签名与版本：${destination}`)
