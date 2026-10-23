/**
 * 网页端端到端检查（本地手动运行）：启动 out/server，用 Playwright 驱动 dist-web，
 * 走一遍 登录 → 目录浏览加电影库 → 成人模式关闭时 /jav 被挡 → 打开成人模式进「番号」页 → 番号页加番号库 →
 * 电影页不出番号条目 → 番号页演员库（列表 → 演员详情 → 编辑并锁定 → 作品 → 条目详情里点演员回到演员详情）→
 * 旧链接（/movie?actor= / ?item=）落到番号页 → 网页播放器 → 关闭成人模式后番号内容不可见。
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
const javWall = page.getByRole('grid', { name: '番号海报墙' })
const sidebar = page.getByRole('complementary', { name: '媒体中心导航' })
/** 侧栏导航项。 */
const navItem = label =>
  sidebar.getByRole('button', { name: label, exact: true })
const hash = () => decodeURIComponent(new URL(page.url()).hash)
/** 用顶栏搜索的口令切换成人模式（真实界面路径）。 */
async function toggleAdultMode() {
  const search = page.locator('.global-search-field input')
  await search.fill('getav')
  await search.press('Enter')
}
/** 关掉设置面板（Esc 由面板自己处理，先把焦点放进去）。 */
async function closeSheet(title) {
  const sheet = page.getByRole('dialog', { name: title })
  await sheet.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
}
/** 带登录 cookie 调片库 RPC。 */
async function rpc(method, params) {
  const cookie = (await page.context().cookies())[0]
  const response = await fetch(`${base}/api/library/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${cookie.name}=${cookie.value}`,
    },
    body: JSON.stringify({ method, params }),
  })
  return (await response.json()).result
}
/** 在目录浏览器里选 media/<name> 并添加。 */
async function pickFolder(name) {
  await page.getByText('选择文件夹').waitFor()
  await page.getByRole('button', { name: 'media' }).click()
  await page.getByRole('button', { name }).click()
  await page.locator('.folder-browser__path', { hasText: `/${name}` }).waitFor()
  await page.screenshot({ path: shot(`3-picker-${name}`) })
  await page.getByRole('button', { name: '添加', exact: true }).click()
}
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
  await pickFolder('movies')
  step('目录浏览：根目录 → media → movies')
  // 只认海报墙里的格子：目录浏览器里也有 “Inception (2010)” 文字，不能拿来当证据
  await wall
    .getByRole('gridcell', { name: /Inception/ })
    .waitFor({ timeout: 15000 })
  step('添加 movies 文件夹后海报墙出现 Inception（无 TMDB 令牌，未识别）')
  await page.screenshot({ path: shot('4-wall-tmdb') })

  // 成人模式关闭：侧栏没有「番号」，直接打开 /jav 回首页
  if (await navItem('番号').count())
    throw new Error('成人模式关闭时侧栏出现了「番号」')
  await page.goto(`${base}/#/jav`)
  await page.waitForFunction(() => location.hash === '#/')
  step('成人模式关闭：侧栏无「番号」，直接打开 /jav 被挡回首页')
  await page.goto(`${base}/#/movie`)
  await wall.getByRole('gridcell', { name: /Inception/ }).waitFor()

  // 打开成人模式 → 侧栏「本地媒体」出现「番号」→ 番号页空状态
  await toggleAdultMode()
  const javNav = navItem('番号')
  await javNav.waitFor({ timeout: 5000 })
  await javNav.click()
  await page.getByText('添加你的番号文件夹').waitFor({ timeout: 10000 })
  step(`成人模式开启：侧栏出现「番号」，进入 ${hash()} 显示番号空状态`)
  await page.screenshot({ path: shot('5-jav-empty') })

  // 番号页的「添加文件夹…」直接建番号库
  await page.getByRole('button', { name: '添加文件夹…' }).click()
  await pickFolder('jav')
  const poster = javWall.locator('img[src*="/media/image/"]').first()
  await poster.waitFor({ timeout: 20000 })
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('img[src*="/media/image/"]')].some(
        img => img.complete && img.naturalWidth > 0
      ),
    null,
    { timeout: 15000 }
  )
  const libs = await rpc('listLibraries')
  const javLib = libs.find(l => l.source === 'jav')
  if (!javLib) throw new Error('番号页添加的不是番号库')
  step(
    `番号页添加 jav 文件夹 → source=jav 的库；番号海报经 /media/image 加载：${await poster.getAttribute('src')}`
  )
  await page.screenshot({ path: shot('6-jav-wall') })

  // 番号设置：番号站点、演员资料来源都在这里
  await page.getByRole('button', { name: '番号库设置' }).click()
  await page.getByText('番号站点').first().waitFor()
  await page.getByText('演员资料').first().waitFor()
  step('番号库设置：有番号站点、演员资料来源')
  await page.screenshot({ path: shot('6a-jav-settings') })
  await page.getByText('番号站点').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: shot('6b-jav-sites') })
  await closeSheet('番号库设置')

  // 电影页不出番号条目，设置里没有番号入口，没有演员视图
  await navItem('电影').click()
  await wall.getByRole('gridcell', { name: /Inception/ }).waitFor()
  const movieCells = await wall.getByRole('gridcell').count()
  const leaked = await wall.getByRole('gridcell', { name: /SSIS|FC2/ }).count()
  if (leaked) throw new Error(`电影页露出了 ${leaked} 个番号条目`)
  if (await page.getByRole('tab', { name: '演员' }).count())
    throw new Error('电影页出现了「演员」视图')
  await page.getByRole('button', { name: '电影库设置' }).click()
  await page.getByText('电影文件夹').first().waitFor()
  if (
    (await page.getByText('添加番号文件夹…').count()) ||
    (await page.getByText('番号站点').count())
  )
    throw new Error('电影设置里还有番号入口')
  await page.screenshot({ path: shot('7-movie-only') })
  await closeSheet('电影库设置')
  step(
    `电影页只有 ${movieCells} 个条目（Inception），无番号条目、无演员视图，设置里无番号入口`
  )

  // 演员库：番号库识别后演员入库，「演员」视图在番号页
  await navItem('番号').click()
  await javWall.waitFor()
  await page.getByRole('tab', { name: '演员' }).click()
  const actorCard = page.locator('.lib-actor-card', { hasText: '鷲尾めい' })
  await actorCard.waitFor({ timeout: 15000 })
  const cards = await page.locator('.lib-actor-card').count()
  step(
    `番号页演员视图：${cards} 位演员，含「鷲尾めい」（${await actorCard.locator('.lib-actor-works').innerText()}）`
  )
  await page.screenshot({ path: shot('8-actors') })
  await actorCard.click()
  const actorWall = page.getByRole('grid', { name: '鷲尾めい的作品' })
  await actorWall
    .getByRole('gridcell', { name: /SSIS-497/ })
    .waitFor({ timeout: 10000 })
  const actorHash = hash()
  step(`演员详情：作品墙有 SSIS-497，地址 ${actorHash}`)
  await page.screenshot({ path: shot('8a-actor-detail') })
  await page.getByRole('button', { name: '编辑资料' }).click()
  await page.locator('#actor-height').fill('155')
  await page.locator('#actor-birthday').fill('1998-09-02')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.lib-actor-fact', { hasText: '155 cm' }).waitFor()
  await page.getByText('已锁定 2 项').waitFor()
  await page
    .getByRole('dialog', { name: '编辑演员资料' })
    .waitFor({ state: 'hidden' })
  step('编辑资料：身高、生日保存后显示并自动锁定 2 项')
  await page.screenshot({ path: shot('8b-actor-edited') })
  await actorWall.getByRole('gridcell', { name: /SSIS-497/ }).click()
  const person = page.locator('.lib-person-target.is-link', {
    hasText: '鷲尾めい',
  })
  await person.waitFor({ timeout: 10000 })
  const itemHash = hash()
  await page.screenshot({ path: shot('8c-item-cast') })
  await person.click()
  await actorWall.waitFor({ timeout: 10000 })
  step('条目详情的演职员里点演员 → 回到演员详情')

  // 旧链接兼容：原来挂在电影页上的演员 / 番号条目链接落到番号页
  const actorId = new URLSearchParams(actorHash.split('?')[1]).get('actor')
  await page.goto(`${base}/#/movie?actor=${actorId}`)
  await page.waitForFunction(() => location.hash.startsWith('#/jav?'))
  await actorWall.waitFor({ timeout: 10000 })
  step(`旧链接 /movie?actor=${actorId} → ${hash()}`)
  const itemId = new URLSearchParams(itemHash.split('?')[1]).get('item')
  await page.goto(`${base}/#/movie?item=${itemId}`)
  await page.waitForFunction(() => location.hash.startsWith('#/jav?'))
  await page.locator('.lib-hero-actions').waitFor({ timeout: 10000 })
  step(`旧链接 /movie?item=${itemId}（番号条目）→ ${hash()}`)
  await page.screenshot({ path: shot('9-legacy-link') })

  const play = page
    .locator('.lib-hero-actions')
    .getByRole('button', { name: /播放/ })
    .first()
  // 侧栏也有“播放记录”，只认详情页顶部的播放按钮
  await play.waitFor({ timeout: 10000 })
  step('打开详情')
  await play.click()
  const video = page.locator('.player-modal video')
  await video.waitFor({ timeout: 10000 })
  const src = await video.getAttribute('src')
  const cookie = (await page.context().cookies())[0]
  const range = await fetch(new URL(src, base), {
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
      range: 'bytes=0-15',
    },
  })
  step(`播放弹窗：<video src=${src}>，Range 请求 → HTTP ${range.status}`)
  if (range.status !== 206)
    throw new Error(`视频流不支持 Range：${range.status}`)
  await page.screenshot({ path: shot('10-player') })
  await page.keyboard.press('Escape')

  // 关闭成人模式：离开番号页，番号条目旧链接也不再显示
  await page.goto(`${base}/#/jav`)
  // 番号页停在上次的「演员」视图（keep-alive），以视图切换为准
  await page.getByRole('tab', { name: '演员' }).waitFor()
  await toggleAdultMode()
  await page.waitForFunction(() => location.hash === '#/')
  await page.goto(`${base}/#/movie?item=${itemId}`)
  await page.waitForFunction(() => location.hash === '#/')
  if (await navItem('番号').count())
    throw new Error('关闭成人模式后侧栏仍有「番号」')
  step('关闭成人模式：离开番号页；番号条目的旧链接被挡回首页，侧栏无「番号」')
  await page.screenshot({ path: shot('11-adult-off') })
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
