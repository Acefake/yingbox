/**
 * 用真实 TMDB 重新录制 tests/fixtures/tmdb 下的响应（详情、季、剧集分组），覆盖手写的 fixture。
 *
 *   VITE_TMDB_ACCESS_TOKEN=eyJ... pnpm exec tsx scripts/record-tmdb-fixtures.ts
 *
 * 文件路径即 API 路径（movie/603.json → /movie/603），请求参数与引擎 TmdbProvider 完全一致，
 * 录完跑 pnpm test 看识别集成测试是否仍然通过。测试里依赖的季 / 集数、标题等若与真实数据不同，
 * 以真实数据为准修改测试期望。
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const token =
  process.env.VITE_TMDB_ACCESS_TOKEN || process.env.YINGBOX_TMDB_TOKEN
if (!token) {
  console.error('需要环境变量 VITE_TMDB_ACCESS_TOKEN（TMDB v4 读访问令牌）')
  process.exit(1)
}

const DIR = join(__dirname, '../tests/fixtures/tmdb')
const MOVIE_APPEND =
  'credits,images,external_ids,translations,alternative_titles,release_dates'
const TV_APPEND =
  'credits,images,external_ids,translations,alternative_titles,content_ratings,episode_groups'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

async function main(): Promise<void> {
  for (const file of files(DIR).filter(f => f.endsWith('.json'))) {
    const path = `/${relative(DIR, file)
      .replace(/\\/g, '/')
      .replace(/\.json$/, '')}`
    const params = new URLSearchParams({ language: 'zh-CN' })
    if (/^\/movie\/\d+$/.test(path))
      params.set('append_to_response', MOVIE_APPEND)
    if (/^\/tv\/\d+$/.test(path)) params.set('append_to_response', TV_APPEND)
    if (/^\/(movie|tv)\/\d+$/.test(path)) {
      params.set('include_image_language', 'zh,en,null')
    }
    const res = await fetch(`https://api.themoviedb.org/3${path}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`${path}: HTTP ${res.status}，保留原 fixture`)
      continue
    }
    writeFileSync(file, `${JSON.stringify(await res.json(), null, 1)}\n`)
    console.log(`已录制 ${path}`)
    // TMDB 限速约 50 rps，这里保守一些
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

void main()
