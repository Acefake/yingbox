import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
const ROOT = process.env.DIST, OUT = process.env.OUT, IMG = process.env.IMG_DIR || new URL('./img/', import.meta.url).pathname
const only = process.argv[2] || 'all'
mkdirSync(OUT, { recursive: true })
const mock = readFileSync(new URL('./mock-library.js', import.meta.url), 'utf8')
const browser = await chromium.launch()
const metrics = {}
async function page(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' })
  await ctx.addInitScript(`localStorage.setItem('yingbox-theme', '${theme}'); localStorage.setItem('library.tmdbTokenMigrated','1');` + mock)
  await ctx.route('https://image.tmdb.org/**', r => r.fulfill({ path: join(IMG, basename(new URL(r.request().url()).pathname)), contentType: 'image/jpeg', headers: { 'cache-control': 'max-age=3600' } }))
  await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname === '127.0.0.1') return r.continue(); return u.hostname === 'image.tmdb.org' ? r.fallback() : r.abort() })
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('pageerror', e.message))
  return p
}
const BASE = 'http://127.0.0.1:4179/index.html'
const settle = p => p.waitForTimeout(900)
for (const theme of ['dark', 'light']) {
  const p = await page(theme)
  await p.goto(`${BASE}#/movie`); await p.waitForSelector('.lib-cell-title'); await settle(p)
  await p.screenshot({ path: `${OUT}/wall-${theme}.png` })
  if (theme === 'dark') {
    // 快速甩动后停下：图片应在停下后补上
    await p.evaluate(async () => { const el = document.querySelector('.lib-wall'); for (let i = 0; i < 60; i++) { el.scrollTop += 300; await new Promise(r => requestAnimationFrame(r)) } })
    await p.waitForTimeout(800)
    metrics.afterFling = await p.evaluate(() => { const cells = [...document.querySelectorAll('.lib-cell')]; const vis = cells.filter(c => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }); return { visible: vis.length, withImage: vis.filter(c => c.querySelector('img[data-loaded]')).length, withPosterOrFallback: vis.filter(c => c.querySelector('img,.lib-cell-fallback')).length } })
    await p.screenshot({ path: `${OUT}/wall-after-fling-${theme}.png` })
  }
  // 电影详情
  await p.goto(`${BASE}#/movie?item=2`); await p.waitForSelector('.lib-hero-meta'); await settle(p)
  await p.screenshot({ path: `${OUT}/detail-movie-${theme}.png` })
  await p.locator('.lib-detail').evaluate(el => el.scrollTo({ top: 640 })); await p.waitForTimeout(400)
  await p.screenshot({ path: `${OUT}/detail-movie-info-${theme}.png` })
  // 剧集详情
  await p.goto(`${BASE}#/tv?item=50002`); await p.waitForSelector('.lib-episode'); await settle(p)
  await p.screenshot({ path: `${OUT}/detail-tv-${theme}.png` })
  await p.locator('.lib-detail').evaluate(el => el.scrollTo({ top: 560 })); await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}/detail-tv-episodes-${theme}.png` })
  // 待确认
  await p.goto(`${BASE}#/movie`); await p.waitForSelector('.lib-cell-title')
  await p.locator('.lib-toolbar-views').getByRole('tab', { name: /待确认/ }).click()
  await p.locator('.review-list-head').getByRole('tab', { name: '待确认', exact: true }).click()
  await p.waitForSelector('.match-candidate'); await settle(p)
  await p.screenshot({ path: `${OUT}/review-${theme}.png` })
  // 设置
  await p.getByRole('tab', { name: '资料库' }).click()
  await p.getByRole('button', { name: '电影库设置' }).click(); await p.waitForSelector('.lib-sheet'); await settle(p)
  await p.screenshot({ path: `${OUT}/settings-${theme}.png` })
  await p.locator('.lib-sheet-body').evaluate(el => el.scrollTo({ top: 10000 })); await p.waitForTimeout(300)
  await p.screenshot({ path: `${OUT}/settings-writer-${theme}.png` })
  await p.keyboard.press('Escape'); await p.locator('.lib-sheet-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {}); await p.waitForTimeout(400)
  if (theme === 'dark') {
    // 多选 + 整理预览
    const cells = p.locator('.lib-cell')
    await cells.nth(0).click({ modifiers: ['Control'] }); await cells.nth(1).click({ modifiers: ['Control'] }); await cells.nth(2).click({ modifiers: ['Control'] })
    await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/wall-selection-${theme}.png` })
    await p.getByRole('button', { name: '整理…' }).click(); await p.waitForSelector('.org-table'); await settle(p)
    await p.screenshot({ path: `${OUT}/organize-${theme}.png` })
    // 搜索
    await p.keyboard.press('Escape'); await p.locator('.lib-sheet-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await p.getByRole('button', { name: '取消选择' }).click().catch(() => {})
    const t = Date.now(); await p.getByPlaceholder('搜索电影').fill('极光 12')
    await p.waitForFunction(() => document.querySelector('.lib-toolbar-count')?.textContent?.trim() !== '50,000')
    metrics.searchMs = Date.now() - t
    await settle(p); await p.screenshot({ path: `${OUT}/search-${theme}.png` })
  }
  await p.context().close()
}
writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2))
await browser.close()
