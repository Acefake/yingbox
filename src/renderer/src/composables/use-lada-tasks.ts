/**
 * 去马赛克（lada）与「边跑边看」的后台任务状态。
 *
 * 两个任务都在主进程里跑，跟当前停留在哪个页面无关，所以状态放在模块级单例里：
 * AppLayout 启动时接一次 IPC 推送，Amane 页面与刮削队列面板读同一份数据。
 */
import { computed, h, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import type { LadaJob, LadaLiveStatus } from '../../../shared/lada'
import { openMediaPlayer } from './use-media-player'

const job = ref<LadaJob | null>(null)
const live = ref<LadaLiveStatus | null>(null)
const liveBusy = ref(false)
/** 区间去码在跑：它的产物还要拼接补音轨，完成后由 range-ready 单独提示 */
const pendingRange = ref(false)
let attached = false

/** 取文件名：路径可能是 Windows 反斜杠写法 */
function fileName(input?: string): string {
  return (input || '').split(/[\\/]/).pop() || '视频'
}

/** 把 "10:30" / "1:02:03" / "630" 解析成秒数；解析不了返回 null */
function parseClock(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const parts = text.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  let seconds = 0
  for (const part of parts) {
    const value = part.trim()
    if (!/^\d+(\.\d+)?$/.test(value)) return null
    seconds = seconds * 60 + Number(value)
  }
  return seconds
}

/** 秒数 → "m:ss" / "h:mm:ss"（给人看的写法） */
function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 推送只在第一次使用时挂一次，跟着应用生命周期走 */
function attach(): void {
  if (attached) return
  attached = true
  const api = window.api?.lada
  if (!api) return
  api.onProgress?.(next => {
    job.value = next
  })
  api.onFinished?.(next => {
    job.value = next
    // 区间任务：成功要等拼接补音轨（range-ready），取消/失败在这里收尾
    if (pendingRange.value) {
      if (next?.state === 'done' || next?.state === 'running') return
      pendingRange.value = false
      if (next?.state === 'failed') message.error(next.error || '区间处理失败')
      else message.info('已取消区间处理')
      return
    }
    if (next?.state === 'done') message.success('去码完成，现在点「播放」就是无码版本')
    else if (next?.state === 'failed') message.error(next.error || '去码失败')
  })
  // 区间产物好了才播：lada 跑完时文件还没拼好
  api.onRangeReady?.(info => {
    pendingRange.value = false
    if (!info?.path) {
      message.error(info?.error || '这一段没处理成功')
      return
    }
    void openMediaPlayer({ filePath: info.path, title: info.title }).then(opened => {
      if (opened) message.success('这一段已经去码完成，正在播放')
      else message.warning(`这一段已处理完，但播放器没打开。文件：${info.path}`)
    })
  })
  void api
    .status?.()
    .then(current => {
      job.value = current ?? null
    })
    .catch(() => undefined)
  // 主进程停止追播后会广播一次 cancelled，对界面来说等同于「没有了」
  api.onLive?.(next => {
    live.value = next && next.state !== 'cancelled' ? next : null
  })
  void api
    .liveStatus?.()
    .then(current => {
      live.value = current ?? null
    })
    .catch(() => undefined)
}

export function useLadaTasks() {
  attach()

  const restoreRunning = computed(() => job.value?.state === 'running')
  const restoreName = computed(() => fileName(job.value?.input))
  const restorePercent = computed(() =>
    Math.max(0, Math.min(100, job.value?.percent ?? 0))
  )
  const restorePercentText = computed(() => {
    const current = job.value
    if (!current) return ''
    if (current.percent === null) return '准备中…'
    const fps = current.fps ? ` · ${current.fps.toFixed(1)} 帧/秒` : ''
    return `${current.percent}%${fps}`
  })

  const hasLive = computed(() => Boolean(live.value))
  const liveName = computed(() => fileName(live.value?.input))
  const liveFailed = computed(() => live.value?.state === 'failed')
  const liveSummary = computed(() => {
    const current = live.value
    if (!current) return ''
    if (current.state === 'failed') return current.error || '启动失败'
    const done = current.state === 'finished' ? ' · 已处理完' : ''
    return `已可观看 ${current.availableSeconds} 秒 · ${current.segments} 个分片${done}`
  })

  /** 有没有正在跑的后台任务（收起时也用来做一行摘要） */
  const hasRuntime = computed(() => restoreRunning.value || hasLive.value)
  const runtimeSummary = computed(() => {
    const parts: string[] = []
    if (restoreRunning.value)
      parts.push(
        `去码中 ${job.value?.percent === null ? '准备中' : `${restorePercent.value}%`}`
      )
    if (live.value)
      parts.push(`边跑边看 已可看 ${live.value.availableSeconds} 秒`)
    return parts.join(' · ')
  })

  async function startRestore(filePath: string): Promise<void> {
    const api = window.api?.lada
    if (!api) throw new Error('去码仅在桌面客户端可用')
    const result = await api.start(filePath)
    if (!result?.success) throw new Error(result?.error || '无法启动去码')
    job.value = result.job ?? null
    message.info('已开始去码（后台运行，进度在「刮削队列」）')
  }

  /**
   * 有未完成的进度时先问一句：继续还是从头重跑。
   * lada 命令行本身不支持续跑，续跑由主进程"裁剩余 → 跑剩余 → 拼接补音轨"实现。
   */
  async function startRestoreSmart(filePath: string): Promise<void> {
    const api = window.api?.lada
    if (!api) throw new Error('去码仅在桌面客户端可用')
    const progress = await api.resumeInfo(filePath).catch(() => null)
    if (progress && progress.doneSeconds > 5) {
      const minutes = Math.round(progress.doneSeconds / 60)
      const resume = await new Promise<boolean>(resolve => {
        Modal.confirm({
          title: '这部片子有未完成的进度',
          content: `上次已处理约 ${minutes} 分钟。接着处理，还是从头重跑？`,
          okText: '接着处理',
          cancelText: '从头重跑',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (resume) {
        const result = await api.resume(filePath)
        if (!result?.success) throw new Error(result?.error || '无法继续处理')
        message.info(`已从上次的位置（约 ${minutes} 分钟处）继续处理`)
        return
      }
    }
    await startRestore(filePath)
  }

  /** 该片子是否有可继续的进度（界面上用来显示「继续」） */
  async function getResumeInfo(filePath: string) {
    const api = window.api?.lada
    if (!api?.resumeInfo) return null
    return api.resumeInfo(filePath).catch(() => null)
  }

  async function cancelRestore(): Promise<void> {
    const api = window.api?.lada
    if (!api) return
    await api.cancel()
    message.info('已取消去码')
  }

  /** 让用户填一段区间；返回 null 表示取消 */
  function askRange(): Promise<{ start: number; end: number } | null> {
    return new Promise(resolve => {
      const startEl = ref<HTMLInputElement | null>(null)
      const endEl = ref<HTMLInputElement | null>(null)
      const field = (placeholder: string, element: typeof startEl) =>
        h('input', { ref: element, class: 'yb-field', style: 'width:100%', placeholder })
      void Modal.confirm({
        title: '只去码指定的一段',
        width: 460,
        content: () =>
          h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
            h(
              'p',
              { style: 'margin:0;opacity:.75' },
              '填成 10:00（10 分 00 秒）或直接填秒数。终点留空表示到片尾。会从最近的关键帧开始，误差通常不到 1 秒。'
            ),
            h('label', { style: 'display:flex;align-items:center;gap:8px' }, [
              h('span', { style: 'width:34px' }, '起点'),
              field('例如 10:00', startEl),
            ]),
            h('label', { style: 'display:flex;align-items:center;gap:8px' }, [
              h('span', { style: 'width:34px' }, '终点'),
              field('例如 20:00（留空 = 到片尾）', endEl),
            ]),
          ]),
        okText: '开始处理这一段',
        cancelText: '取消',
        onOk: () => {
          const start = parseClock(startEl.value?.value ?? '')
          if (start === null) {
            message.error('起点填成 10:00，或者直接填秒数')
            return Promise.reject(new Error('起点格式不对'))
          }
          const endText = (endEl.value?.value ?? '').trim()
          const end = endText ? parseClock(endText) : 0
          if (end === null) {
            message.error('终点填成 20:00，或者直接填秒数')
            return Promise.reject(new Error('终点格式不对'))
          }
          if (end > 0 && end <= start) {
            message.error('终点要大于起点')
            return Promise.reject(new Error('终点不大于起点'))
          }
          resolve({ start, end })
          return undefined
        },
        onCancel: () => resolve(null),
        afterClose: () => resolve(null),
      })
    })
  }

  /** 区间去码：先问区间，再只处理这一段（跑完会自动播放） */
  async function startRangeSmart(filePath: string): Promise<void> {
    const api = window.api?.lada
    if (!api?.startRange) throw new Error('区间去码仅在桌面客户端可用')
    const picked = await askRange()
    if (!picked) return
    pendingRange.value = true
    try {
      const result = await api.startRange(filePath, picked.start, picked.end)
      if (!result?.success) throw new Error(result?.error || '无法开始处理这一段')
      const span = `${fmtClock(result.start ?? picked.start)} - ${fmtClock(result.end ?? 0)}`
      message.info(`已开始处理 ${span}，跑完会自动播放`)
    } catch (error) {
      pendingRange.value = false
      throw error
    }
  }

  /** 起 lada + 追播：每个分片自带音视频同一区间，音频不会跑到视频前面 */
  async function startLive(filePath: string): Promise<void> {
    const api = window.api?.lada
    if (!api || liveBusy.value) return
    liveBusy.value = true
    const hide = message.loading('正在准备边跑边看（首次加载模型约 30 秒）…', 0)
    try {
      const result = await api.startLive(filePath)
      if (!result?.success || !result.url)
        throw new Error(result?.error || '无法启动边跑边看')
      const title = `${fileName(filePath)}（去码中）`
      if (!(await openMediaPlayer({ url: result.url, title })))
        throw new Error('无法打开播放器（本功能需要 mpv 引擎）')
      message.success('已开始：处理到哪，就能看到哪')
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      hide()
      liveBusy.value = false
    }
  }

  async function stopLive(): Promise<void> {
    const api = window.api?.lada
    if (!api) return
    await api.stopLive()
    live.value = null
    message.info('已停止边跑边看')
  }

  /** 追播已经失败时没什么可停的，点一下只是收掉这一行 */
  function dismissLive(): void {
    live.value = null
  }

  return {
    job,
    live,
    liveBusy,
    restoreRunning,
    restoreName,
    restorePercent,
    restorePercentText,
    hasLive,
    liveName,
    liveFailed,
    liveSummary,
    hasRuntime,
    runtimeSummary,
    startRestore,
    startRestoreSmart,
    startRangeSmart,
    getResumeInfo,
    cancelRestore,
    startLive,
    stopLive,
    dismissLive,
  }
}
