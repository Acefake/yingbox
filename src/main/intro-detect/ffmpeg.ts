/**
 * 用 ffmpeg 取一集开头 / 结尾一段音频的指纹。
 *
 * - ffmpeg 路径由调用方给（index.ts 沿用去码插件的定位 ladaPaths）；本文件不依赖 electron，便于脚本试跑；
 * - ffmpeg 带 chromaprint 时直接输出原始指纹（-f chromaprint -fp_format raw）；
 *   不带时解码成 11025Hz 单声道 PCM，由 pcm-print 自己算同形状的指纹；
 * - 子进程单线程、低优先级，可随时用 AbortSignal 杀掉；
 * - 输入一律加 file: 前缀，路径里有协议名也只当本地文件读。
 */
import { spawn } from 'node:child_process'
import { constants, setPriority } from 'node:os'

import { runTool } from '../plugins/process'
import { POINT_SECONDS } from './match'
import { PCM_RATE, pcmFingerprint } from './pcm-print'

/** 指纹算法：chromaprint 原始指纹 / 退回方案（PCM 自算） */
export type PrintMethod = 'chromaprint' | 'pcm'

/** 取开头多少秒找片头 */
export const HEAD_SECONDS = 600
/** 取结尾多少秒找片尾 */
export const TAIL_SECONDS = 300

/** 开头 / 结尾各最多看全片的多少（避免短片里片头片尾互相当成对方） */
export const MAX_SHARE = 0.4

/** 一段音频的指纹与这段的实际时长（秒） */
export interface ClipPrint {
  points: Uint32Array
  seconds: number
}

/** 这个 ffmpeg 是否带 chromaprint 输出格式 */
export async function hasChromaprint(ffmpeg: string): Promise<boolean> {
  const { code, out } = await runTool(ffmpeg, ['-hide_banner', '-muxers'])
  return code === 0 && /\bchromaprint\b/.test(out)
}

/** 跑 ffmpeg，收集 stdout（二进制）与 stderr（文字）；被取消或启动失败时 stdout 为 null。 */
function runBinary(
  ffmpeg: string,
  args: string[],
  signal: AbortSignal
): Promise<{ stdout: Buffer | null; stderr: string }> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve({ stdout: null, stderr: '' })
    const child = spawn(ffmpeg, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW)
    } catch {
      /* 调不了优先级不影响结果 */
    }
    const chunks: Buffer[] = []
    let stderr = ''
    const kill = (): void => {
      child.kill('SIGKILL')
    }
    signal.addEventListener('abort', kill, { once: true })
    child.stdout?.on('data', (d: Buffer) => chunks.push(d))
    child.stderr?.on('data', d => {
      if (stderr.length < 20_000) stderr += d
    })
    const done = (ok: boolean): void => {
      signal.removeEventListener('abort', kill)
      resolve({
        stdout: ok && !signal.aborted ? Buffer.concat(chunks) : null,
        stderr,
      })
    }
    child.once('error', () => done(false))
    child.once('close', code => done(code === 0))
  })
}

/** 从 ffmpeg 日志里读出文件总时长（秒）；读不到为 null */
export function parseDuration(log: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** 原始字节 → 32 位小端整数序列 */
function toUint32(buffer: Buffer): Uint32Array {
  const out = new Uint32Array(Math.floor(buffer.length / 4))
  for (let i = 0; i < out.length; i++) out[i] = buffer.readUInt32LE(i * 4)
  return out
}

/** 原始字节 → 16 位小端 PCM */
function toInt16(buffer: Buffer): Int16Array {
  const out = new Int16Array(Math.floor(buffer.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = buffer.readInt16LE(i * 2)
  return out
}

/**
 * 取一集开头（片头）或结尾（片尾）一段音频的指纹；没有音轨、读失败或被取消时返回 null。
 * @param part head = 开头 HEAD_SECONDS 秒；tail = 最后 TAIL_SECONDS 秒
 */
export async function clipPrint(
  ffmpeg: string,
  file: string,
  part: 'head' | 'tail',
  method: PrintMethod,
  signal: AbortSignal
): Promise<ClipPrint | null> {
  const limit = part === 'head' ? HEAD_SECONDS : TAIL_SECONDS
  const seek =
    part === 'head' ? ['-t', String(limit)] : ['-sseof', String(-limit)]
  const output =
    method === 'chromaprint'
      ? ['-f', 'chromaprint', '-fp_format', 'raw', '-']
      : ['-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(PCM_RATE), '-']
  const args = [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'info',
    '-threads',
    '1',
    ...seek,
    '-i',
    `file:${file}`,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '1',
    ...output,
  ]
  const { stdout, stderr } = await runBinary(ffmpeg, args, signal)
  if (!stdout || !stdout.length) return null
  const all =
    method === 'chromaprint'
      ? toUint32(stdout)
      : pcmFingerprint(toInt16(stdout))
  const total = parseDuration(stderr)
  // 片段实际时长：文件比取的长度短时就是整个文件；读不到总时长时按点数估
  const clip =
    method === 'pcm'
      ? stdout.length / 2 / PCM_RATE
      : total !== null
        ? Math.min(limit, total)
        : all.length * POINT_SECONDS
  // 短片（例如十来分钟一集）开头和结尾会互相覆盖：各自只看全片的 MAX_SHARE
  const seconds = total !== null ? Math.min(clip, total * MAX_SHARE) : clip
  const keep = Math.min(all.length, Math.round(seconds / POINT_SECONDS))
  const points =
    part === 'head' ? all.subarray(0, keep) : all.subarray(all.length - keep)
  if (points.length < 2) return null
  return { points, seconds }
}
