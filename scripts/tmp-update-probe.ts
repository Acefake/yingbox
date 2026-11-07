/* 复现「检查更新/下载安装包很慢」：用真实的 publicFetch 走一遍更新器路径，打印每段耗时与速率 */
import { writeFileSync } from 'node:fs'
import { publicFetch } from '../src/main/network'
import { githubAssetCandidates, mirrorCandidates } from '../src/shared/release/mirrors'
import { DEFAULT_NETWORK } from '../src/shared/network/preferences'

const RELEASES = 'https://api.github.com/repos/Acefake/yingbox/releases?per_page=30'

function mbps(bytes: number, ms: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB / ${(ms / 1000).toFixed(1)} s = ${((bytes / 1024 / 1024) / (ms / 1000)).toFixed(2)} MB/s`
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    const out = await fn()
    console.log(`[ok] ${label}: ${Date.now() - t0} ms`)
    return out
  } catch (e) {
    console.log(`[fail] ${label}: ${Date.now() - t0} ms — ${(e as Error).name}: ${(e as Error).message}`)
    throw e
  }
}

async function main(): Promise<void> {
  console.log('--- 1. 发布列表（updater 用 fetchFirstOk + publicFetch） ---')
  const list = await timed('releases json', async () => {
    const r = await publicFetch(RELEASES, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'yingbox-desktop' },
    })
    return (await r.json()) as Array<{ tag_name: string; assets: Array<{ name: string; size: number; browser_download_url: string }> }>
  })
  const release = list.find(r => r.tag_name.startsWith('v1.'))!
  const asset = release.assets.find(a => a.name.endsWith('.exe'))!
  console.log(`release=${release.tag_name} asset=${asset.name} size=${(asset.size / 1024 / 1024).toFixed(1)} MB`)

  console.log('\n--- 2. 候选列表 ---')
  const url = asset.browser_download_url
  console.log('mirrorCandidates:', mirrorCandidates(url, DEFAULT_NETWORK).map(u => u.slice(0, 60)))
  console.log('githubAssetCandidates:', githubAssetCandidates(url, DEFAULT_NETWORK).map(u => u.slice(0, 60)))

  console.log('\n--- 3. 走 updater 实际用的 publicFetch 下载 30 秒，统计速率 ---')
  const t0 = Date.now()
  let received = 0
  let firstByteAt = 0
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await publicFetch(url, {
      headers: { 'User-Agent': 'yingbox-desktop' },
      signal: controller.signal,
    })
    console.log(`响应: status=${res.status} url=${res.url?.slice(0, 80)}`)
    const reader = res.body!.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (!firstByteAt) {
        firstByteAt = Date.now()
        console.log(`首包: ${firstByteAt - t0} ms`)
      }
      received += value.byteLength
    }
  } catch (e) {
    console.log(`下载中断: ${(e as Error).name}: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  const elapsed = Date.now() - t0
  console.log(`收到 ${mbps(received, elapsed)}`)
  if (firstByteAt) console.log(`首包后速率: ${((received / 1024 / 1024) / ((Date.now() - firstByteAt) / 1000)).toFixed(2)} MB/s`)

  console.log('\n--- 4. 每个候选单独测 15 秒（不经 publicFetch 的镜像展开） ---')
  for (const candidate of githubAssetCandidates(url, DEFAULT_NETWORK)) {
    const c = new AbortController()
    const tt = setTimeout(() => c.abort(), 15_000)
    const s = Date.now()
    let n = 0
    let first = 0
    try {
      const r = await fetch(candidate, { headers: { 'User-Agent': 'yingbox-desktop' }, signal: c.signal })
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
      const reader = r.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!first) first = Date.now() - s
        n += value.byteLength
      }
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? '15 秒到' : `${(e as Error).name}: ${(e as Error).message}`
      console.log(`  ${candidate.slice(0, 55)} → 首包 ${first} ms，${mbps(n, Date.now() - s)}（${msg}）`)
      clearTimeout(tt)
      continue
    }
    console.log(`  ${candidate.slice(0, 55)} → 首包 ${first} ms，${mbps(n, Date.now() - s)}（完整下完）`)
    clearTimeout(tt)
    break
  }

  writeFileSync('out/update-probe.done', 'ok')
}

void main()
