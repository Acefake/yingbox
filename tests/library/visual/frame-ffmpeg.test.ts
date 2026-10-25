/**
 * 真 ffmpeg 取帧（机器上没有 ffmpeg 时跳过）：224×224 RGBA 走标准输出、小缩略图落盘，
 * 超出片长返回 null，找不到程序报 FfmpegMissingError，读时长。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FRAME_BYTES,
  FfmpegMissingError,
  extractFrame,
  ffmpegDuration,
} from '../../../src/main/library/visual/frames/frame-ffmpeg'

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** JPEG 的 SOF0 段里读宽度。 */
function jpegWidth(bytes: Buffer): number {
  for (let i = 2; i < bytes.length - 9; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2))
      return bytes.readUInt16BE(i + 7)
  }
  return 0
}

describe.skipIf(!hasFfmpeg)('ffmpeg 取帧', () => {
  let dir: string
  let video: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'yb-frames-'))
    video = join(dir, 'clip.mp4')
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=12:size=320x180:rate=10',
      '-pix_fmt',
      'yuv420p',
      video,
    ])
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('取到原始像素与小缩略图', async () => {
    const thumb = join(dir, 'a.jpg')
    const px = await extractFrame(
      'ffmpeg',
      video,
      5,
      thumb,
      new AbortController().signal
    )
    expect(px?.length).toBe(FRAME_BYTES)
    expect(jpegWidth(readFileSync(thumb))).toBe(240)
  })

  it('超出片长返回 null、不留缩略图', async () => {
    const thumb = join(dir, 'b.jpg')
    expect(
      await extractFrame(
        'ffmpeg',
        video,
        60,
        thumb,
        new AbortController().signal
      )
    ).toBeNull()
    expect(existsSync(thumb)).toBe(false)
  })

  it('读时长', async () => {
    expect(await ffmpegDuration('ffmpeg', video)).toBeCloseTo(12, 0)
  })
})

describe('找不到 ffmpeg', () => {
  it('取帧与读时长都报 FfmpegMissingError', async () => {
    const bin = join(tmpdir(), 'no-such-ffmpeg-binary')
    await expect(
      extractFrame(bin, 'x.mp4', 1, 'x.jpg', new AbortController().signal)
    ).rejects.toBeInstanceOf(FfmpegMissingError)
    await expect(ffmpegDuration(bin, 'x.mp4')).rejects.toBeInstanceOf(
      FfmpegMissingError
    )
  })
})
