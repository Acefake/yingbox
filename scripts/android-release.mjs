/** 本机安卓发布：构建、校验签名和版本、生成摘要，再公开完整的 GitHub 草稿。 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
import { ensureRemoteTag } from './android/release-tag.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
const publish = process.argv.includes('--publish')
if (process.argv.slice(2).some(arg => arg !== '--publish'))
  throw new Error('用法：node scripts/android-release.mjs [--publish]')
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
const tag = `android-v${version}`
const head = run('git', ['rev-parse', 'HEAD']).trim()
if (
  publish &&
  run('git', ['status', '--porcelain', '--untracked-files=no']).trim()
)
  throw new Error('提交源码后再发布，版本标签必须对应完整代码')
if (
  publish &&
  run('git', [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'src',
    'scripts',
    'tests',
    'android/app',
    'android/version.properties',
  ]).trim()
)
  throw new Error('仍有未提交的源码或版本文件，不能发布')
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
const files = []
const sums = []
let certificate = ''
const expectedCertificate = readFileSync(
  join(root, 'android/release-certificate.sha256'),
  'utf8'
)
  .trim()
  .toLowerCase()
if (!/^[a-f0-9]{64}$/.test(expectedCertificate))
  throw new Error('发布证书指纹无效')
for (const abi of ['arm64-v8a', 'x86_64']) {
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
  sums.push(
    `${createHash('sha256').update(readFileSync(target)).digest('hex')}  ${name}`
  )
  files.push(target)
}
const checksums = join(destination, 'SHA256SUMS.txt')
writeFileSync(checksums, `${sums.join('\n')}\n`)
files.push(checksums)
writeFileSync(
  join(destination, 'build.json'),
  JSON.stringify(
    { version, versionCode, commit: head, certificateSha256: certificate },
    null,
    2
  )
)
console.log(`已校验签名与版本：${destination}`)
if (publish) {
  ensureRemoteTag(root, tag, head)
  const result = spawnSync(
    'gh',
    ['release', 'view', tag, '--json', 'isDraft,targetCommitish'],
    { cwd: root, encoding: 'utf8' }
  )
  if (result.status === 0) {
    const existing = JSON.parse(result.stdout)
    if (!existing.isDraft || existing.targetCommitish !== head)
      throw new Error('同名发布已公开或指向其他提交，不能覆盖')
  } else {
    if (!/not found|404/i.test(result.stderr || ''))
      throw new Error(result.stderr || '查询发布失败')
    run(
      'gh',
      [
        'release',
        'create',
        tag,
        '--target',
        head,
        '--draft',
        '--prerelease',
        '--latest=false',
        '--title',
        `影盒 Android ${version} · 手机与电视`,
        '--notes-file',
        join(root, 'docs/tv/android-release-notes.md'),
      ],
      { stdio: 'inherit' }
    )
  }
  run('gh', ['release', 'upload', tag, ...files, '--clobber'], {
    stdio: 'inherit',
  })
  const releaseId = JSON.parse(
    run('gh', ['release', 'view', tag, '--json', 'databaseId'])
  ).databaseId
  const uploaded = JSON.parse(
    run('gh', ['api', `repos/{owner}/{repo}/releases/${releaseId}`])
  ).assets
  for (const file of files) {
    const bytes = readFileSync(file)
    const name = file.replaceAll('\\', '/').split('/').at(-1)
    const asset = uploaded.find(value => value.name === name)
    const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (
      !asset ||
      asset.state !== 'uploaded' ||
      asset.size !== bytes.length ||
      asset.digest !== expected
    )
      throw new Error(`远端资产不完整或摘要不匹配，保留草稿：${name}`)
  }
  run(
    'gh',
    ['release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false'],
    { stdio: 'inherit' }
  )
  console.log(
    run('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url']).trim()
  )
}
