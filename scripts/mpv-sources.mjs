/** Windows mpv 的完整对应源码单独交付，安装包保留许可和下载说明。 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const tar = path.join(process.env.WINDIR || 'C:/Windows', 'System32/tar.exe')

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function download(file, source, fetcher) {
  if ((await sha256(file).catch(() => '')) === source.sha256) return
  await mkdir(path.dirname(file), { recursive: true })
  const part = `${file}.part`
  try {
    const response = await fetcher(source.url)
    if (!response.ok || !response.body)
      throw new Error(
        `mpv 材料下载失败：${source.filename} (${response.status})`
      )
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part))
    if ((await sha256(part)) !== source.sha256)
      throw new Error(`mpv 材料校验失败：${source.filename}`)
    await rename(part, file)
  } finally {
    await rm(part, { force: true })
  }
}

function member(archive, name, tarPath) {
  return execFileSync(tarPath, ['-xOf', archive, name], {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
}

/**
 * 同一二进制配方的源包必须存在且哈希匹配；缺失材料会阻止打包。
 * @param {{ root?: string, fetcher?: (url: string) => Promise<Response>, tarPath?: string }} [options]
 */
export async function prepareMpvSources({
  root = projectRoot,
  fetcher = fetch,
  tarPath = tar,
} = {}) {
  const lockPath = path.join(root, 'src/shared/mpv-distribution.json')
  const lockText = await readFile(lockPath, 'utf8')
  const lock = JSON.parse(lockText)
  const lockHash = createHash('sha256').update(lockText).digest('hex')
  const building = await readFile(path.join(root, 'docs/release-licenses.md'))
  const materialHash = createHash('sha256')
    .update(lockText)
    .update(building)
    .digest('hex')
  const cache = path.join(root, 'output/mpv-cache')
  const output = path.join(root, 'resources/mpv-sources')
  const archive = path.join(output, `${lock.id}-sources.tar`)
  const markerPath = path.join(output, 'source-bundle.json')
  await mkdir(output, { recursive: true })
  async function exportDownload(digest) {
    const filename = path.basename(archive)
    const releaseDir = path.join(root, 'dist')
    const instructions = [
      '# Windows mpv 对应源码下载',
      '',
      `源码包：[${filename}](./${filename})。与影盒安装包在同一下载页面或交付目录提供，无需额外付费。`,
      '',
      '完整源码、补丁、PKGBUILD、许可和构建记录在此归档中；播放无需下载或安装源码。',
      '',
      `SHA-256：${digest}`,
      '',
      '发布者须同时上传安装包、源码包、校验文件及本说明，并在安装包旁提供清晰的源码下载入口；不可仅链接上游项目首页。',
      '',
    ].join('\n')
    await mkdir(releaseDir, { recursive: true })
    await copyFile(archive, path.join(releaseDir, filename))
    await writeFile(
      path.join(releaseDir, `${filename}.sha256`),
      `${digest}  ${filename}\n`
    )
    await writeFile(
      path.join(releaseDir, 'MPV-SOURCE-DOWNLOAD.md'),
      instructions
    )
    await writeFile(path.join(output, 'DOWNLOAD.md'), instructions)
  }
  const notices = [
    '# Windows mpv 原生组件',
    '',
    '下列许可名称来自上游包元数据。完整版权与许可原文保留在对应源包内；包内独立声明见 resources/mpv/share/licenses，常用许可全文另见本目录 licenses。完整源码、补丁、PKGBUILD 及二进制构建记录另供下载，获取方式见 DOWNLOAD.md。',
    '',
  ]
  for (const pkg of [...lock.packages, ...lock.buildInputs]) {
    const source = lock.sources.find(s => s.key === pkg.sourceKey)
    if (!source || source.pkgbuildSha256 !== pkg.pkgbuildSha256)
      throw new Error(`缺少对应源码：${pkg.name}`)
    notices.push(
      `- ${pkg.name} ${pkg.version}: ${pkg.licenses.join(' / ')}; ${pkg.homepage}`
    )
  }
  await cp(path.join(root, 'licenses'), path.join(output, 'licenses'), {
    recursive: true,
  })
  await writeFile(path.join(output, 'NOTICES.md'), `${notices.join('\n')}\n`)
  await writeFile(path.join(output, 'BUILDING.md'), building)
  await writeFile(path.join(output, 'manifest.json'), lockText)
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'))
    if (
      marker.lockSha256 === lockHash &&
      marker.materialSha256 === materialHash &&
      marker.sha256 === (await sha256(archive))
    ) {
      console.log(
        `[mpv sources] 已校验 ${lock.sources.length} 份源码：${archive}`
      )
      await exportDownload(marker.sha256)
      return
    }
  } catch {
    /* 没有可复用的完整源码包。 */
  }

  const staging = path.join(cache, 'source-bundle')
  await rm(staging, { recursive: true, force: true })
  await mkdir(path.join(staging, 'sources'), { recursive: true })
  await mkdir(path.join(staging, 'binary-metadata'), { recursive: true })
  await mkdir(output, { recursive: true })
  try {
    for (const source of lock.sources) {
      const file = path.join(cache, 'sources', source.filename)
      await download(file, source, fetcher)
      const recipe = member(file, `${source.name}/PKGBUILD`, tarPath)
      if (
        createHash('sha256').update(recipe).digest('hex') !==
        source.pkgbuildSha256
      )
        throw new Error(`源码构建配方不匹配：${source.filename}`)
      await copyFile(file, path.join(staging, 'sources', source.filename))
    }
    for (const pkg of [...lock.packages, ...lock.buildInputs]) {
      const file = path.join(cache, 'packages', pkg.filename)
      await download(
        file,
        {
          filename: pkg.filename,
          url: `${lock.binaryRepository}${pkg.filename}`,
          sha256: pkg.sha256,
        },
        fetcher
      )
      const build = member(file, '.BUILDINFO', tarPath)
      if (
        !build.toString().includes(`pkgbuild_sha256sum = ${pkg.pkgbuildSha256}`)
      )
        throw new Error(`二进制构建配方不匹配：${pkg.name}`)
      await writeFile(
        path.join(staging, 'binary-metadata', `${pkg.filename}.BUILDINFO`),
        build
      )
      await writeFile(
        path.join(staging, 'binary-metadata', `${pkg.filename}.PKGINFO`),
        member(file, '.PKGINFO', tarPath)
      )
    }
    await copyFile(lockPath, path.join(staging, 'manifest.json'))
    await cp(path.join(root, 'licenses'), path.join(staging, 'licenses'), {
      recursive: true,
    })
    await copyFile(
      path.join(root, 'docs/release-licenses.md'),
      path.join(staging, 'BUILDING.md')
    )
    await copyFile(
      path.join(output, 'NOTICES.md'),
      path.join(staging, 'NOTICES.md')
    )
    const part = `${archive}.part`
    execFileSync(tarPath, ['-cf', part, '-C', staging, '.'], {
      windowsHide: true,
    })
    await rename(part, archive)
    const archiveHash = await sha256(archive)
    await writeFile(
      markerPath,
      JSON.stringify(
        {
          id: lock.id,
          lockSha256: lockHash,
          materialSha256: materialHash,
          sha256: archiveHash,
        },
        null,
        2
      ) + '\n'
    )
    console.log(
      `[mpv sources] 已归档 ${lock.sources.length} 份源码、${lock.packages.length + lock.buildInputs.length} 份构建记录：${archive}`
    )
    await exportDownload(archiveHash)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await prepareMpvSources()
