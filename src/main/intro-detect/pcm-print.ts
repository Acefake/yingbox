/**
 * 退回方案的音频指纹（纯计算）：ffmpeg 不带 chromaprint 时，用它解码出的 PCM 自己算。
 *
 * 做法是经典的 Philips（Haitsma–Kalker）指纹，输出与 chromaprint 原始指纹同形状的 32 位整数序列，
 * 步长也一样（11025Hz 单声道，帧长 4096、步长 1365 ≈ 0.124 秒），所以 match.ts 的规则两边通用：
 * 1. 每帧加汉宁窗做 FFT，取 300–2000Hz 按对数等分成 33 个频带的能量；
 * 2. 第 m 位 = 相邻频带能量差在时间上是否变大：
 *    (E[n][m] − E[n][m+1]) − (E[n−1][m] − E[n−1][m+1]) > 0。
 * 只看相对变化，音量、编码差异影响很小；静音段每位都是 0，会被 match.ts 的单调段过滤掉。
 */

/** 采样率（Hz） */
export const PCM_RATE = 11025
const FRAME = 4096
const HOP = 1365
const BANDS = 33
const LOW_HZ = 300
const HIGH_HZ = 2000

/** 原地迭代 FFT（基 2），re / im 长度为 2 的幂 */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** 33 个频带的 FFT 下标边界（34 个） */
function bandEdges(): number[] {
  const edges: number[] = []
  for (let m = 0; m <= BANDS; m++) {
    const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, m / BANDS)
    edges.push(Math.round((hz * FRAME) / PCM_RATE))
  }
  return edges
}

/**
 * 由 16 位单声道 PCM（11025Hz）算指纹。
 * @returns 每帧一个 32 位无符号整数；不足两帧时为空
 */
export function pcmFingerprint(samples: Int16Array): Uint32Array {
  const frames = Math.floor((samples.length - FRAME) / HOP) + 1
  if (frames < 2) return new Uint32Array(0)
  const edges = bandEdges()
  const window = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++)
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  let prev = new Float64Array(BANDS)
  let curr = new Float64Array(BANDS)
  const out = new Uint32Array(frames - 1)
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP
    for (let i = 0; i < FRAME; i++) {
      re[i] = (samples[offset + i] / 32768) * window[i]
      im[i] = 0
    }
    fft(re, im)
    for (let m = 0; m < BANDS; m++) {
      let energy = 0
      for (let k = edges[m]; k < edges[m + 1]; k++)
        energy += re[k] * re[k] + im[k] * im[k]
      curr[m] = energy
    }
    if (f > 0) {
      let bits = 0
      for (let m = 0; m < 32; m++) {
        const diff = curr[m] - curr[m + 1] - (prev[m] - prev[m + 1])
        if (diff > 0) bits |= 1 << m
      }
      out[f - 1] = bits >>> 0
    }
    ;[prev, curr] = [curr, prev]
  }
  return out
}
