/**
 * 发布：把目录里的安装包和 sha256sum.txt 放进标签对应的 GitHub Release。
 * 先建草稿并上传，逐个核对远端的大小和摘要，全部一致才公开并设为 Latest；
 * 任何一步失败都保留草稿。已公开的同名发布不覆盖。需要 gh 已登录。
 *
 *   node scripts/release/publish.mjs <标签 vX.Y.Z> <目录> <mpv 源码发布标签>
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHECKSUM_FILE } from './checksums.mjs'
import { releaseNotes } from './notes.mjs'

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })

/** 远端资产与本地文件逐个对照；不一致返回问题列表。 */
export function mismatches(uploaded, local) {
  const problems = []
  for (const { name, size, sha256 } of local) {
    const asset = uploaded.find(a => a.name === name)
    if (
      !asset ||
      asset.state !== 'uploaded' ||
      asset.size !== size ||
      asset.digest !== `sha256:${sha256}`
    )
      problems.push(name)
  }
  return problems
}

async function main([tag, dir, sourcesTag]) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '')?.[1]
  if (!version || !dir || !sourcesTag)
    throw new Error(
      '用法：node scripts/release/publish.mjs <vX.Y.Z> <目录> <源码标签>'
    )
  const names = (await readdir(dir)).sort()
  if (!names.includes(CHECKSUM_FILE))
    throw new Error(`${dir} 里缺少 ${CHECKSUM_FILE}`)
  const local = []
  for (const name of names) {
    const bytes = await readFile(join(dir, name))
    local.push({
      name,
      path: join(dir, name),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  const view = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft'], {
    encoding: 'utf8',
  })
  if (view.status === 0) {
    if (!JSON.parse(view.stdout).isDraft)
      throw new Error(`${tag} 已公开，不能覆盖`)
  } else {
    if (!/not found|404/i.test(view.stderr || ''))
      throw new Error(view.stderr || '查询发布失败')
    const notes = join(dir, '..', `${basename(dir)}-notes.md`)
    await writeFile(notes, releaseNotes({ version, files: names, sourcesTag }))
    gh(
      'release',
      'create',
      tag,
      '--draft',
      '--verify-tag',
      '--title',
      `影盒 ${version}`,
      '--notes-file',
      notes
    )
  }
  gh('release', 'upload', tag, ...local.map(f => f.path), '--clobber')
  const id = JSON.parse(
    gh('release', 'view', tag, '--json', 'databaseId')
  ).databaseId
  const uploaded = JSON.parse(
    gh('api', `repos/{owner}/{repo}/releases/${id}`)
  ).assets
  const problems = mismatches(uploaded, local)
  if (problems.length)
    throw new Error(
      `远端资产不完整或摘要不匹配，保留草稿：${problems.join('、')}`
    )
  gh('release', 'edit', tag, '--draft=false', '--latest')
  console.log(
    gh('release', 'view', tag, '--json', 'url', '--jq', '.url').trim()
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  await main(process.argv.slice(2))
