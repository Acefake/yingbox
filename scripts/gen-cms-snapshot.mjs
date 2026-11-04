/**
 * 生成随包 CMS 快照 src/shared/online/cms-snapshot.json（ADR-0047）。
 * 拉两份内置订阅，剔除成人站，按规范化 api 去重，并入补充站。
 * 默认不测活：开发机网络的探测结果不能改站点清单（ADR-0003），失效站由应用启动检测自动关闭。
 * 用法：node scripts/gen-cms-snapshot.mjs
 */
import { writeFile } from 'node:fs/promises'

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/DaLongZhuaZi/moontv-config@main/config.json',
  'https://cdn.jsdelivr.net/gh/hafrey1/LunaTV-config@main/LunaTV-config.json',
]
const SUPPLEMENT = [
  { name: '虎牙', api: 'https://huyazy.net/api.php/provide/vod/' },
  { name: 'CK', api: 'https://www.ckzy1.com/api.php/provide/vod' },
]
const CMS_API = /^https?:\/\/.+(?:api\.php\/provide\/vod|api\/json\.php)/i
const OUT = new URL('../src/shared/online/cms-snapshot.json', import.meta.url)

const siteKey = api => {
  const u = new URL(api)
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`
}
const cleanName = name =>
  name
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/^[\s\-_·|]+|[\s\-_·|]+$/g, '')
    .trim()

const sites = new Map()
let fetched = 0
for (const url of SOURCES) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const root = await res.json()
    fetched++
    for (const e of Object.values(root.api_site ?? {})) {
      const api = String(e?.api ?? '').trim()
      const raw = String(e?.name ?? '')
      if (!CMS_API.test(api) || e?.is_adult === true || raw.includes('🔞'))
        continue
      const key = siteKey(api)
      if (!sites.has(key))
        sites.set(key, { name: cleanName(raw) || new URL(api).hostname, api })
    }
  } catch (error) {
    console.error(`跳过 ${url}: ${error.message}`)
  }
}
if (!fetched) throw new Error('两个订阅都拉取失败，快照未更新')
for (const s of SUPPLEMENT)
  if (!sites.has(siteKey(s.api))) sites.set(siteKey(s.api), s)

await writeFile(
  OUT,
  `${JSON.stringify({ sites: [...sites.values()] }, null, 2)}\n`
)
console.log(`快照 ${sites.size} 站，来源 ${fetched}/${SOURCES.length}`)
