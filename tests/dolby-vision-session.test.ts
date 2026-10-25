/**
 * 杜比视界播放会话（transcode.ts）的完整生命周期，用一个假的 ffmpeg 脚本（按参数写 init.mp4 与分片）：
 * 开播 → 播放列表 / init / 首片 → 向前拖远重启 → 一轮编完后请求下一轮的分片（不误报 503）→
 * 并发两次开播只留最后一个 → 停止删目录 → 编码失败回 500 → 清扫旧目录。
 * 只在类 Unix 上跑（假 ffmpeg 靠 shebang 执行）。
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { RUN_SEGMENTS } from '../src/main/dolby-vision/filters'
import {
  type SessionPlan,
  sessionRunning,
  setSessionRoot,
  startSession,
  stopSession,
  sweepLeftovers,
} from '../src/main/dolby-vision/transcode'

/**
 * 假 ffmpeg：从 -start_number 起每 FAKE_DV_DELAY（默认 10）毫秒写一段（先 .tmp 再改名），写满 -t 对应的段数后退出；
 * FAKE_DV_FAIL=1 时直接失败；收到 SIGTERM 后 300ms 才退出（模拟编码器重启时的空档）。
 */
const FAKE_FFMPEG = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const after = flag => args[args.indexOf(flag) + 1]
if (process.env.FAKE_DV_FAIL === '1') {
  process.stderr.write('Vulkan init failed\\n')
  process.exit(1)
}
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300))
const start = Number(after('-start_number'))
const count = Math.round(Number(after('-t')) / 4)
const dir = path.dirname(after('-hls_segment_filename'))
fs.writeFileSync(path.join(dir, 'init.mp4'), '')
let i = 0
const timer = setInterval(() => {
  const name = 'seg' + String(start + i).padStart(5, '0') + '.m4s'
  fs.writeFileSync(path.join(dir, name + '.tmp'), 'x')
  fs.renameSync(path.join(dir, name + '.tmp'), path.join(dir, name))
  if (i === 0) fs.writeFileSync(path.join(dir, 'init.mp4'), 'init')
  if (++i >= count) { clearInterval(timer); process.exit(0) }
}, Number(process.env.FAKE_DV_DELAY || 10))
`

const unix = process.platform !== 'win32'
let work = ''
let ffmpeg = ''

const plan = (over: Partial<SessionPlan> = {}): SessionPlan => ({
  input: '/m/p5.mkv',
  ffmpeg,
  encoder: 'libx264',
  output: 'sdr',
  applyDolbyVision: true,
  // 100 段，比一轮（RUN_SEGMENTS）多
  duration: 400,
  startAt: 0,
  ...over,
})

const get = async (url: string): Promise<number> => {
  const res = await fetch(url)
  await res.arrayBuffer()
  return res.status
}
const segUrl = (base: string, i: number): string =>
  base.replace('index.m3u8', `seg${String(i).padStart(5, '0')}.m4s`)

describe.skipIf(!unix)('杜比视界播放会话', () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'dv-session-'))
    ffmpeg = join(work, 'fake-ffmpeg')
    writeFileSync(ffmpeg, FAKE_FFMPEG)
    chmodSync(ffmpeg, 0o755)
    setSessionRoot(join(work, 'sessions'))
  })

  afterEach(async () => {
    delete process.env.FAKE_DV_FAIL
    delete process.env.FAKE_DV_DELAY
    await stopSession()
  })

  afterAll(() => setSessionRoot(join(tmpdir(), 'yingbox-dolby-vision')))

  it('开播：播放列表、init、首片；向前拖远从那一段重启', async () => {
    const { url } = await startSession(plan())
    const playlist = await fetch(url).then(r => r.text())
    expect(playlist).toContain('#EXT-X-ENDLIST')
    expect(await get(url.replace('index.m3u8', 'init.mp4'))).toBe(200)
    expect(await get(segUrl(url, 0))).toBe(200)
    expect(await get(segUrl(url, 80))).toBe(200)
    expect(await get(url.replace('index.m3u8', '../etc'))).toBe(404)
    expect(await get(segUrl(url, 100))).toBe(404)
  })

  it('一轮编完、编码器已退出时请求下一轮的分片：自动续编，不回 503', async () => {
    const { url } = await startSession(plan())
    expect(await get(segUrl(url, 0))).toBe(200)
    // 等首轮（RUN_SEGMENTS 段，每段 10ms）编完退出
    await new Promise(r => setTimeout(r, RUN_SEGMENTS * 10 + 300))
    expect(await get(segUrl(url, RUN_SEGMENTS + 1))).toBe(200)
  })

  it('编码器重启的空档里，正在等的分片请求继续等，不回 503', async () => {
    process.env.FAKE_DV_DELAY = '100'
    // 从第 10 段开始编
    const { url } = await startSession(plan({ startAt: 40 }))
    // 等第 12 段（在前沿附近：等待），同时往回拖到第 5 段（重启，旧进程 300ms 后才退出）
    const waiting = get(segUrl(url, 12))
    await new Promise(r => setTimeout(r, 100))
    const [back, ahead] = await Promise.all([get(segUrl(url, 5)), waiting])
    expect(back).toBe(200)
    expect(ahead).toBe(200)
  })

  it('并发两次开播：都返回，只有后一个的服务还在', async () => {
    const [a, b] = await Promise.all([
      startSession(plan()),
      startSession(plan({ startAt: 40 })),
    ])
    await expect(get(segUrl(a.url, 0))).rejects.toThrow()
    expect(await get(segUrl(b.url, 10))).toBe(200)
    expect(await stopSession(a.id)).toBe(false)
    expect(sessionRunning()).toBe(true)
  })

  it('停止：关服务、删分片目录', async () => {
    const { id, url } = await startSession(plan())
    expect(await get(segUrl(url, 0))).toBe(200)
    const dir = join(work, 'sessions', id)
    expect(existsSync(dir)).toBe(true)
    expect(await stopSession(id)).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(sessionRunning()).toBe(false)
    await expect(get(url)).rejects.toThrow()
  })

  it('编码失败：分片请求回 500', async () => {
    process.env.FAKE_DV_FAIL = '1'
    const { url } = await startSession(plan())
    expect(await get(segUrl(url, 0))).toBe(500)
  })

  it('建目录失败：开播抛错，不留下会话', async () => {
    const blocker = join(work, 'not-a-dir')
    writeFileSync(blocker, '')
    setSessionRoot(blocker)
    try {
      await expect(startSession(plan())).rejects.toThrow()
      expect(sessionRunning()).toBe(false)
    } finally {
      setSessionRoot(join(work, 'sessions'))
    }
  })

  it('清扫：删掉旧目录，保留当前会话的', async () => {
    const { id } = await startSession(plan())
    mkdirSync(join(work, 'sessions', 'stale1'), { recursive: true })
    expect(await sweepLeftovers()).toBe(1)
    expect(existsSync(join(work, 'sessions', 'stale1'))).toBe(false)
    expect(existsSync(join(work, 'sessions', id))).toBe(true)
  })
})
