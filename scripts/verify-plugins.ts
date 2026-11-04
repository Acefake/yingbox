/**
 * 批量验证 CatSpider 插件（ADR-0048）：固定到上游当前提交，在真实引擎沙箱里跑 getConfig 和搜索。
 * 用法：pnpm exec tsx scripts/verify-plugins.ts <输出.json> [--existing]
 * 默认验证上游两个仓库里尚未登记的脚本；`--existing` 验证已登记的插件。结果只供人工审阅，不改注册表。
 */
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { writeFile } from 'node:fs/promises'
import { runCatSpider } from '../src/engine/online/catspider'
import { createPluginLoader } from '../src/engine/online/plugin-cache'
import sitesFile from '../src/engine/online/vod-sites.json'
import { createNetClient } from '../src/shared/net/client'

const REPOS = [
  { owner: 'fangkuia', repo: 'XPTV' },
  { owner: 'Yswag', repo: 'xptv-extensions' },
]
const KEYWORDS = ['流浪地球', '庆余年']
const out = process.argv[2]
if (!out) throw new Error('缺少输出文件参数')
const existing = process.argv.includes('--existing')

const net = createNetClient({
  fetch: (input, init) => fetch(input, init),
  lookup: host => lookup(host, { all: true }),
})
const dir = `${process.env.TEMP ?? '/tmp'}/yingbox-verify-plugins`
const sha256Of = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

interface Target {
  file: string
  url: string
  name?: string
  sha256?: string
}

async function listTargets(): Promise<Target[]> {
  if (existing)
    return (
      sitesFile.sites as Array<{ name: string; ext: string; sha256?: string }>
    ).map(s => ({
      file: s.ext.split('/').pop() ?? s.ext,
      url: s.ext,
      name: s.name,
      sha256: s.sha256,
    }))
  const used = new Set(
    (sitesFile.sites as Array<{ ext: string }>).map(s => s.ext.split('/').pop())
  )
  const targets: Target[] = []
  for (const { owner, repo } of REPOS) {
    const head = (await (
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/HEAD`,
        { headers: { 'User-Agent': 'yingbox' } }
      )
    ).json()) as { sha: string }
    const list = (await (
      await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/js`, {
        headers: { 'User-Agent': 'yingbox' },
      })
    ).json()) as Array<{ name: string; path: string }>
    for (const f of list)
      if (f.name.endsWith('.js') && !used.has(f.name))
        targets.push({
          file: `${owner}/${f.name}`,
          url: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${head.sha}/${f.path}`,
        })
  }
  return targets
}

interface Result {
  file: string
  url: string
  sha256?: string
  title?: string
  ok: boolean
  count?: number
  ms?: number
  sample?: string
  error?: string
}

async function verify(target: Target): Promise<Result> {
  const result: Result = { file: target.file, url: target.url, ok: false }
  const started = Date.now()
  try {
    const code = await createPluginLoader(
      net,
      dir,
      Date.now,
      () => target.sha256
    )(target.url)
    result.sha256 = sha256Of(code)
    const deps = {
      net,
      browserFetch: async () => '',
      loadPlugin: async () => code,
      log: () => {},
    }
    const config = (await runCatSpider(deps, target.url, 'getConfig', {})) as
      | { data?: { title?: string } }
      | undefined
    result.title =
      target.name ??
      JSON.stringify(config).match(/"(?:title|site)":"([^"]+)"/)?.[1]
    for (const keyword of KEYWORDS) {
      const data = (await runCatSpider(deps, target.url, 'search', {
        text: keyword,
        page: 1,
      })) as unknown
      const text = JSON.stringify(data)
      const list = data as { list?: unknown[]; data?: { list?: unknown[] } }
      const items = list?.list ?? list?.data?.list
      if (Array.isArray(items) && items.length) {
        result.ok = true
        result.count = items.length
        result.sample = text.slice(0, 160)
        break
      }
      result.error = text.slice(0, 160)
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  result.ms = Date.now() - started
  return result
}

async function main(): Promise<void> {
  const targets = await listTargets()
  const results: Result[] = []
  const queue = [...targets]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const t = queue.shift()
        if (!t) break
        const r = await Promise.race([
          verify(t),
          new Promise<Result>(resolve =>
            setTimeout(
              () =>
                resolve({
                  file: t.file,
                  url: t.url,
                  ok: false,
                  error: '超时 60s',
                }),
              60000
            )
          ),
        ])
        results.push(r)
        console.log(
          r.ok ? 'OK ' : 'BAD',
          r.file,
          r.title ?? '',
          r.count ?? r.error?.slice(0, 60) ?? ''
        )
      }
    })
  )
  await writeFile(out, JSON.stringify(results, null, 2))
  console.log(`通过 ${results.filter(r => r.ok).length} / ${results.length}`)
}

void main()
