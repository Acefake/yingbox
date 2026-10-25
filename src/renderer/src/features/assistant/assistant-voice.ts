/**
 * AI 助手的录音：麦克风 → MediaRecorder 录一段 → 解码后重采样成 16 kHz 单声道 16 位 WAV，
 * 交给主进程用「设置 → AI → 语音识别」的配置转写（assistant.transcribe）。
 *
 * 聆听时用 AnalyserNode 读真实音量（每帧一次 rAF），光球随之起伏；停止或取消时关掉麦克风、
 * AudioContext 与 rAF。录到 ASSISTANT_VOICE_MAX_SECONDS 秒自动停止录制，解码时也按这个上限截断。
 */
import { ASSISTANT_VOICE_MAX_SECONDS } from '../../../../shared/assistant'
import type { VoiceSession } from './use-assistant'

/** 转写用的采样率 */
export const VOICE_SAMPLE_RATE = 16_000

/** 当前环境能否录音（桌面端 + 浏览器支持麦克风与 MediaRecorder） */
export function voiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.api?.assistant) &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/**
 * 一帧波形的音量（0–1）：均方根放大后截顶，正常说话大约 0.3–0.8。
 * @param samples 时域采样（-1–1）
 */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.min(1, Math.sqrt(sum / samples.length) * 4)
}

/**
 * 单声道浮点采样 → 16 位 PCM WAV（44 字节标准头）。
 * @param samples -1–1 的采样，越界的截顶
 * @param sampleRate 采样率
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** 录音解码后重采样成 16 kHz 单声道 */
async function toMono16k(
  blob: Blob,
  context: AudioContext
): Promise<Float32Array> {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer())
  const seconds = Math.min(decoded.duration, ASSISTANT_VOICE_MAX_SECONDS)
  const length = Math.max(1, Math.ceil(seconds * VOICE_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/** 录音被取消时 stop() 抛出的错误 */
export class VoiceCancelledError extends Error {
  constructor() {
    super('录音已取消')
    this.name = 'VoiceCancelledError'
  }
}

/**
 * 开始录音。麦克风打开后任何一步失败都会先关掉麦克风与 AudioContext 再抛错；
 * 录满 {@link ASSISTANT_VOICE_MAX_SECONDS} 秒自动停止录制并调用 onLimit（调用方接着 stop() 转写）。
 * stop() 解码期间被 cancel()：等解码结束后释放，stop() 抛 {@link VoiceCancelledError}。
 * @param onLevel 每帧的音量（0–1）
 * @param onLimit 录满上限时调用
 */
export async function startVoice(
  onLevel: (level: number) => void,
  onLimit?: () => void
): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  let context: AudioContext | null = null
  let raf = 0
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const release = (): void => {
    if (closed) return
    closed = true
    clearTimeout(limitTimer)
    cancelAnimationFrame(raf)
    stream.getTracks().forEach(track => track.stop())
    void context?.close().catch(() => {})
  }

  let recorder: MediaRecorder
  let stopped: Promise<void>
  const chunks: Blob[] = []
  try {
    context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream).connect(analyser)
    const frame = new Float32Array(analyser.fftSize)
    recorder = new MediaRecorder(stream)
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) chunks.push(event.data)
    })
    stopped = new Promise<void>(resolve =>
      recorder.addEventListener('stop', () => resolve(), { once: true })
    )
    let smooth = 0
    const tick = (): void => {
      analyser.getFloatTimeDomainData(frame)
      // 起得快、落得慢，光球不抖
      const next = rmsLevel(frame)
      smooth = next > smooth ? next : smooth * 0.85 + next * 0.15
      onLevel(smooth)
      raf = requestAnimationFrame(tick)
    }
    recorder.start()
    raf = requestAnimationFrame(tick)
    limitTimer = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
      onLimit?.()
    }, ASSISTANT_VOICE_MAX_SECONDS * 1000)
  } catch (error) {
    release()
    throw error
  }

  /** stop() 正在解码 */
  let stopping = false
  /** 解码期间被取消 */
  let cancelled = false

  return {
    async stop() {
      if (closed) throw new VoiceCancelledError()
      stopping = true
      clearTimeout(limitTimer)
      try {
        if (recorder.state !== 'inactive') recorder.stop()
        await stopped
        if (cancelled || !context) throw new VoiceCancelledError()
        const blob = new Blob(chunks, { type: recorder.mimeType })
        const samples = await toMono16k(blob, context)
        if (cancelled) throw new VoiceCancelledError()
        return encodeWav(samples, VOICE_SAMPLE_RATE)
      } finally {
        stopping = false
        release()
      }
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop()
      cancelled = true
      // 解码中先不关 AudioContext，由 stop() 结束时释放
      if (!stopping) release()
    },
  }
}

/** 交给主进程转写 */
export function transcribeVoice(
  audio: Uint8Array,
  isPrivate: boolean
): Promise<string> {
  const api = window.api?.assistant
  if (!api) return Promise.reject(new Error('语音输入需要桌面端'))
  return api.transcribe(audio, isPrivate)
}
