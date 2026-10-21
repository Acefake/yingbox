/**
 * 网页端端到端检查（手动跑，不进 CI）：启动 out/server，用 Playwright 驱动 dist-web，
 * 走一遍 登录 → 目录浏览加电影库 → 经 API 加番号库 → 事件推送刷新海报墙 → 详情 → 网页播放器。
 *
 * 出网走 scripts/smoke/fixture-fetch.mjs（离线夹具），不碰真实网络。
 *
 * 前置：npm run build:web && npm run build:server；Playwright 不是项目依赖，自备：
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node scripts/web-e2e.mjs
 * 截图写到 E2E_SHOTS（默认系统临时目录下的 yingbox-e2e-shots）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const playwrightModule = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(
  playwrightModule ? pathToFileURL(playwrightModule).href : 'playwright'
)

const TOKEN = 'e2e-token-0123456789abcdef'
const PORT = Number(process.env.E2E_PORT ?? 31577)
const base = `http://127.0.0.1:${PORT}`
const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'yingbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const shot = name => join(shots, `${name}.png`)

const work = mkdtempSync(join(tmpdir(), 'yb-e2e-'))
const media = join(work, 'media')
/** 造一个假视频文件（内容无所谓，播放器只验证地址与 Range）。 */
function write(path, size) {
  mkdirSync(dirname(join(media, path)), { recursive: true })
  writeFileSync(join(media, path), Buffer.alloc(size, 1))
}
write('movies/Inception (2010)/Inception.2010.1080p.mp4', 1024)
write('jav/SSIS-497/SSIS-497-C.mp4', 4096)
write('jav/FC2-PPV-3662771.mp4', 2048)

const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', join(REPO, 'out/server/server.js')],
  {
    env: {
      ...process.env,
      YINGBOX_PORT: String(PORT),
      YINGBOX_DATA_DIR: join(work, 'data'),
      YINGBOX_MEDIA_ROOTS: media,
      YINGBOX_SERVER_TOKEN: TOKEN,
      // 夹具文件刚写出，mtime 很新：不做写入稳定判定，建库后立即入库
      YINGBOX_SETTLE_SECONDS: '0',
      YINGBOX_WEB_DIR: join(REPO, 'dist-web'),
      YINGBOX_FETCH: `module:${join(REPO, 'scripts/smoke/fixture-fetch.mjs')}`,
    },
    stdio: 'inherit',
  }
)
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (let i = 0; i < 50; i++) {
  if (
    await fetch(`${base}/api/health`).then(
      r => r.ok,
      () => false
    )
  )
    break
  await sleep(100)
}

const log = []
const step = message => {
  log.push(message)
  console.log('STEP', message)
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
page.on('pageerror', error => console.log('PAGEERROR', error.message))
const wall = page.getByRole('grid', { name: '电影海报墙' })
try {
  await page.goto(`${base}/#/movie`)
  await page.getByText('登录片库服务').waitFor({ timeout: 15000 })
  step('未登录：电影页显示「登录片库服务」')
  await page.screenshot({ path: shot('1-login') })
  await page.getByPlaceholder('访问令牌').fill('wrong')
  await page.getByRole('button', { name: '连接' }).click()
  await page.getByText('令牌不正确').waitFor()
  step('错误令牌提示「令牌不正确」')
  await page.getByPlaceholder('访问令牌').fill(TOKEN)
  await page.getByRole('button', { name: '连接' }).click()
  await page.getByText('添加你的电影文件夹').waitFor({ timeout: 15000 })
  step('登录后：显示「添加你的电影文件夹」空状态')
  await page.screenshot({ path: shot('2-empty') })

  await page.getByRole('button', { name: '添加文件夹…' }).click()
  await page.getByText('选择文件夹').waitFor()
  await page.getByRole('button', { name: 'media' }).click()
  await page.getByRole('button', { name: 'movies' }).click()
  await page.locator('.folder-browser__path', { hasText: '/movies' }).waitFor()
  await page.screenshot({ path: shot('3-picker') })
  step('目录浏览：根目录 → media → movies')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  // 只认海报墙里的格子：目录浏览器里也有 “Inception (2010)” 文字，不能拿来当证据
  await wall
    .getByRole('gridcell', { name: /Inception/ })
    .waitFor({ timeout: 15000 })
  step('添加 movies 文件夹后海报墙出现 Inception（无 TMDB 令牌，未识别）')
  await page.screenshot({ path: shot('4-wall-tmdb') })

  // 番号库：经 API 建（界面入口在设置里，走同一个 addLibrary）
  const cookie = (await page.context().cookies())[0]
  const response = await fetch(`${base}/api/library/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${cookie.name}=${cookie.value}`,
    },
    body: JSON.stringify({
      method: 'addLibrary',
      params: { root: join(media, 'jav'), kind: 'movie', source: 'jav' },
    }),
  })
  step(`API 建番号库：${JSON.stringify((await response.json()).ok)}`)
  const poster = wall.locator('img[src*="/media/image/"]').first()
  await poster.waitFor({ timeout: 20000 })
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('img[src*="/media/image/"]')].some(
        img => img.complete && img.naturalWidth > 0
      ),
    null,
    { timeout: 15000 }
  )
  step(
    `事件推送刷新海报墙，番号海报经 /media/image 加载：${await poster.getAttribute('src')}`
  )
  await page.screenshot({ path: shot('5-wall-jav') })

  await poster.click()
  const play = page
    .locator('.lib-hero-actions')
    .getByRole('button', { name: /播放/ })
    .first()
  // 侧栏也有“播放记录”，只认详情页顶部的播放按钮
  await play.waitFor({ timeout: 10000 })
  await page.screenshot({ path: shot('6-detail') })
  step('打开详情')
  await play.click()
  const video = page.locator('video.web-player__video')
  await video.waitFor({ timeout: 10000 })
  const src = await video.getAttribute('src')
  const range = await fetch(new URL(src, base), {
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
      range: 'bytes=0-15',
    },
  })
  step(`网页播放器：<video src=${src}>，Range 请求 → HTTP ${range.status}`)
  if (range.status !== 206)
    throw new Error(`视频流不支持 Range：${range.status}`)
  await page.screenshot({ path: shot('7-player') })
} catch (error) {
  console.log('FAIL', error.message)
  await page.screenshot({ path: shot('fail') })
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill('SIGTERM')
  await sleep(300)
  rmSync(work, { recursive: true, force: true })
  console.log(`\n${log.join('\n')}\n截图：${shots}`)
}
