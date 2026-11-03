/** 发布说明：各端对应的文件和校验方法。 */
import { pathToFileURL } from 'node:url'

/** 文件名 → 它是哪一端的安装包；不认识的文件返回 null。 */
export function platformOf(name) {
  if (/^yingbox-setup-.+\.exe$/.test(name)) return 'Windows'
  if (/\.dmg$/.test(name)) return 'macOS'
  if (/^yingbox-android-.+-arm64-v8a\.apk$/.test(name))
    return '安卓（手机、电视，arm64-v8a）'
  return null
}

/** 生成发布说明正文。 */
export function releaseNotes({ version, files }) {
  const rows = files
    .map(name => [platformOf(name), name])
    .filter(([platform]) => platform)
    .map(([platform, name]) => `| ${platform} | \`${name}\` |`)
  return [
    `## 影盒 ${version}`,
    '',
    '| 平台 | 文件 |',
    '| --- | --- |',
    ...rows,
    '',
    `NAS：\`docker pull ghcr.io/acefake/yingbox-nas:${version}-nas.1\`。`,
    '',
    '校验：下载后对照 `sha256sum.txt`，Windows 用 `Get-FileHash <文件> -Algorithm SHA256`，macOS / Linux 用 `shasum -a 256 <文件>`。',
    '',
  ].join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [version, ...files] = process.argv.slice(2)
  process.stdout.write(releaseNotes({ version, files }))
}
