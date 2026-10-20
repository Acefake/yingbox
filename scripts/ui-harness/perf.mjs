import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
const IMG = process.env.IMG_DIR || new URL('./img/', import.meta.url).pathname
const mock = readFileSync(new URL('./mock-library.js', import.meta.url), 'utf8')
const SPEED = Number(process.env.SPEED || 60)
const browser = await chromium.launch({ args: (process.env.ARGS || '').split(' ').filter(Boolean) })
const measure = async ([sel, speed]) => {
  const el = document.querySelector(sel)
  const longTasks = []
  const po = new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push(e.duration))); po.observe({ type: 'longtask' })
  const frames = []; let last = performance.now(); const t0 = last
  await new Promise(res => { function step(t) { frames.push(t - last); last = t; el.scrollTop += speed; if (t - t0 < 4000) requestAnimationFrame(step); else res() } requestAnimationFrame(step) })
  po.disconnect()
  const scrolled = el.scrollTop
  frames.shift(); frames.sort((a, b) => a - b)
  const q = f => +frames[Math.min(frames.length - 1, Math.floor(frames.length * f))].toFixed(1)
  const out = { fps: +(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1), p50: q(.5), p95: q(.95), p99: q(.99), max: q(1), over20ms: frames.filter(f => f > 20).length, frames: frames.length, longTasks: longTasks.length, longTaskMaxMs: Math.round(Math.max(0, ...longTasks)), scrolledPx: scrolled }
  const cells = document.querySelectorAll('.lib-cell').length
  if (cells) {
    Object.assign(out, { renderedCells: cells, domNodes: document.querySelectorAll('*').length, queries: window.__libStats.queries })
    const t = performance.now(); el.scrollTop = el.scrollHeight
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    out.jumpToEndFrameMs = +(performance.now() - t).toFixed(1)
    await new Promise(r => setTimeout(r, 500))
    out.lastTitle = [...document.querySelectorAll('.lib-cell-title')].pop()?.textContent
    out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
  }
  return out
}
async function run(name, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript("localStorage.setItem('library.tmdbTokenMigrated','1');" + mock)
  await ctx.route('https://image.tmdb.org/**', r => r.fulfill({ path: join(IMG, basename(new URL(r.request().url()).pathname)), contentType: 'image/jpeg' }))
  const p = await ctx.newPage()
  const sel = await setup(p)
  const r = await p.evaluate(measure, [sel, SPEED])
  console.log(name, JSON.stringify(r)); await ctx.close()
}
// 基线 1：静态长页面，60 个纯色块，只滚不渲染新内容（浏览器本身的上限）
await run('baseline-static', async p => { await p.setContent(`<div id=s style="height:900px;overflow:auto"><div style="height:200000px;position:relative">${Array.from({length:60},(_,i)=>`<div style="position:absolute;top:${i*330}px;left:${(i%6)*190}px;width:168px;height:252px;border-radius:12px;background:hsl(${i*6} 60% 50%)"></div>`).join('')}</div></div>`); return '#s' })
await run('wall', async p => { await p.goto('http://127.0.0.1:4179/index.html#/movie'); await p.waitForSelector('.lib-cell-title'); await p.waitForTimeout(800); return '.lib-wall' })
if (!process.env.ABL) for (const i of [2, 3]) await run(`wall#${i}`, async p => { await p.goto('http://127.0.0.1:4179/index.html#/movie'); await p.waitForSelector('.lib-cell-title'); await p.waitForTimeout(800); return '.lib-wall' })
if (process.env.ABL) await run('wall-no-img', async p => { await p.goto('http://127.0.0.1:4179/index.html#/movie'); await p.waitForSelector('.lib-cell-title'); await p.addStyleTag({ content: '.lib-cell-media img{display:none!important}' }); await p.waitForTimeout(800); return '.lib-wall' })
if (process.env.ABL) await run('wall-no-text', async p => { await p.goto('http://127.0.0.1:4179/index.html#/movie'); await p.waitForSelector('.lib-cell-title'); await p.addStyleTag({ content: '.lib-cell-title,.lib-cell-sub,.lib-cell-badge,.lib-cell-rating{display:none!important}' }); await p.waitForTimeout(800); return '.lib-wall' })
if (process.env.ABL) await run('wall-no-shadow-radius', async p => { await p.goto('http://127.0.0.1:4179/index.html#/movie'); await p.waitForSelector('.lib-cell-title'); await p.addStyleTag({ content: '.lib-cell-media{box-shadow:none!important;border-radius:0!important}' }); await p.waitForTimeout(800); return '.lib-wall' })
await browser.close()
