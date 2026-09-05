import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const keyword = process.argv[2] || '流浪地球'
const root = process.cwd()
const configPath = path.join(root, 'packages/services/backend/py/vod.json')
const runner = path.join(root, 'packages/services/backend/py/catspider_runner.js')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const sites = (config.sites || []).filter(site => site.type === 3)

const runAction = (site, action, payload) => new Promise(resolve => {
  const child = spawn(process.execPath, [runner, site.ext, action, JSON.stringify(payload)], { cwd: root })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => child.kill(), 20000)
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  child.on('close', code => {
    clearTimeout(timer)
    let parsed = null
    try { parsed = JSON.parse(stdout) } catch { /* keep raw output */ }
    resolve({ code, response: parsed, raw: stdout, stderr })
  })
})

const run = async site => {
  const searchResult = await runAction(site, 'search', { siteName: site.name, keyword, text: keyword, page: 1 })
  let trackResult = null
  const list = searchResult.response?.data?.list || searchResult.response?.data?.data?.list || []
  const normalized = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const wanted = normalized(keyword)
  const match = list.find(item => {
    const title = normalized(item?.vod_name || item?.title || item?.name)
    return title && (title === wanted || title.includes(wanted) || wanted.includes(title))
  })
  if (match) {
    trackResult = await runAction(site, 'getTracks', {
      siteName: site.name,
      id: match.ext?.id ?? match.vod_id,
      url: match.ext?.url || match.vod_id,
      ...match.ext,
    })
  }
  return { site, keyword, search: searchResult, match, tracks: trackResult }
}

const results = []
for (const site of sites) {
  process.stdout.write(`诊断中: ${site.name} (${site.api})\n`)
  results.push(await run(site))
}

const output = results.map((result, index) => [
  `===== ${index + 1}. ${result.site.name} | ${result.site.api} | ${result.site.ext} =====`,
  `keyword: ${result.keyword}`,
  `searchExitCode: ${result.search.code}`,
  `searchStderr: ${result.search.stderr.trim() || '(empty)'}`,
  `searchRawResponse: ${result.search.raw.trim() || '(empty)'}`,
  `matchedItem: ${result.match ? JSON.stringify(result.match) : '(none)'}`,
  `tracksExitCode: ${result.tracks?.code ?? '(not called)'}`,
  `tracksStderr: ${result.tracks?.stderr?.trim() || '(empty)'}`,
  `tracksRawResponse: ${result.tracks?.raw?.trim() || '(not called)'}`,
  '',
].join('\n')).join('\n')
const outputPath = path.join(root, 'vod-source-results.log')
fs.writeFileSync(outputPath, output, 'utf8')
console.log(`完成: ${results.length} 个源，日志已保存到 ${outputPath}`)
