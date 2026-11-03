/** 把发布版本写入 android/version.properties（versionCode 由 Gradle 按 x*10000+y*100+z 算出）。 */
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** 版本号须是 x.y.z，y、z 不超过 99，x 不超过 214747。 */
export function androidVersionFile(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  if (!m) throw new Error(`版本号应为 x.y.z：${version}`)
  const [major, minor, patch] = m.slice(1).map(Number)
  if (major > 214747 || minor > 99 || patch > 99 || major + minor + patch === 0)
    throw new Error(`版本号超出安卓版本码范围：${version}`)
  return `versionName=${version}\n`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await writeFile(
    'android/version.properties',
    androidVersionFile(process.argv[2])
  )
}
