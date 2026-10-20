/**
 * 片库页的操作：刮削、播放（优先去码产物）、去码 / 区间去码 / 边跑边看、整理、
 * 媒体库扫描、任务重试与队列暂停。
 *
 * 去码状态在 useLadaTasks 里（刮削队列面板展示同一份），这里只负责找到文件路径。
 * 整理不刮削、不改元数据，但**会移动视频文件**，所以每次都先确认。
 */
import type { ComputedRef, Ref } from 'vue'
import { message } from 'ant-design-vue'
import { openMediaPlayer } from '@/features/player'
import { useLadaTasks } from '@/features/lada'
import {
  type AmaneDetail,
  type AmaneFile,
  type AmaneLibrary,
  amaneRequest,
} from '../api/amane'
import {
  type AmaneTab,
  organizeFilesConfirm,
  organizeLibraryConfirm,
  playTitle,
} from '../utils/library-query'

export interface ActionContext {
  /** Web/PWA：没有本地文件能力 */
  isWeb: boolean
  run: (action: () => Promise<void>) => Promise<void>
  detail: Ref<AmaneDetail | null>
  files: Ref<AmaneFile[]>
  selectedIds: Ref<number[]>
  workerPaused: Ref<boolean>
  switchTab: (tab: AmaneTab) => void
  load: () => Promise<void>
}

/** 新建媒体库的表单 */
export interface LibraryInput {
  name: string
  path: string
  automation: AmaneLibrary['automation']
}

/** useAmaneActions 的返回值：刮削、播放、去码、整理、媒体库与任务操作 */
export interface AmaneActions {
  restoreRunning: ComputedRef<boolean>
  liveBusy: Ref<boolean>
  scrapeNumber: (number: string) => Promise<boolean>
  scrapeFilms: (ids: number[]) => Promise<void>
  scrapeFile: (file: AmaneFile, input: string) => Promise<void>
  play: (id: number) => Promise<void>
  restoreFile: (id: number) => Promise<void>
  rangeFile: (id: number) => Promise<void>
  watchLive: (id: number) => Promise<void>
  organizeFile: (id: number) => Promise<void>
  organizeLibrary: (library: AmaneLibrary) => Promise<void>
  addLibrary: (input: LibraryInput) => Promise<boolean>
  scanLibrary: (library: AmaneLibrary, scrape: boolean) => Promise<void>
  retryTask: (id: number) => Promise<void>
  setWorker: (paused: boolean) => Promise<void>
}

export function useAmaneActions(ctx: ActionContext): AmaneActions {
  const { isWeb, run } = ctx
  const {
    restoreRunning,
    liveBusy,
    startRestoreSmart,
    startRangeSmart,
    startLive,
  } = useLadaTasks()

  /** 在详情或文件列表里找文件 */
  function findFile(id: number): AmaneFile | undefined {
    return (
      ctx.detail.value?.files?.find(item => item.id === id) ||
      ctx.files.value.find(item => item.id === id)
    )
  }

  /** 找到文件路径；找不到时提示并返回 null */
  function filePath(id: number): string | null {
    const file = findFile(id)
    if (!file?.path) {
      message.error('找不到该文件的路径')
      return null
    }
    return file.path
  }

  async function scrapeNumber(number: string): Promise<boolean> {
    let queued = false
    await run(async () => {
      await amaneRequest('/tasks', 'POST', {
        type: 'scrape',
        number: number.trim(),
      })
      queued = true
      message.success('已加入 Amane 刮削队列')
      ctx.switchTab('tasks')
    })
    return queued
  }

  async function scrapeFilms(ids: number[]): Promise<void> {
    await run(async () => {
      await amaneRequest('/metadata/batch/scrape', 'POST', { ids })
      ctx.selectedIds.value = []
      message.success('已加入 Amane 刮削队列')
    })
  }

  /** 先改番号（有变化时）再加入刮削队列 */
  async function scrapeFile(file: AmaneFile, input: string): Promise<void> {
    const number = (input || file.number || '').trim()
    if (!number) {
      message.info('请先在文件的番号栏输入番号')
      return
    }
    await run(async () => {
      if (number !== file.number)
        await amaneRequest(`/media/${file.id}`, 'PATCH', { number })
      await amaneRequest('/tasks', 'POST', {
        type: 'scrape',
        media_id: file.id,
        number,
      })
      message.success('已加入 Amane 刮削队列')
    })
  }

  async function play(id: number): Promise<void> {
    await run(async () => {
      if (isWeb)
        throw new Error('手机/网页端暂不支持本地文件播放，请在桌面客户端打开')
      const result = await window.api.amane.resolveMedia(id)
      if (!result.success || !result.filePath)
        throw new Error(result.error || '无法播放关联文件')
      // 同目录若已有 .restored.mp4（去码产物），优先播它
      let target = result.filePath
      let restored = false
      try {
        const preferred = await window.api.lada.playablePath(result.filePath)
        if (preferred?.path) {
          target = preferred.path
          restored = Boolean(preferred.restored)
        }
      } catch {
        /* 探测失败就播原片 */
      }
      // 交给统一播放器，遵循设置中的播放器引擎（内置 / mpv）。
      if (
        !(await openMediaPlayer({ filePath: target, title: playTitle(target) }))
      )
        throw new Error('无法打开播放器，请完全重启应用后重试')
      if (restored) message.success('正在播放无码版本')
    })
  }

  /** 找到文件路径并发起去码 */
  async function restoreFile(id: number): Promise<void> {
    const path = filePath(id)
    if (!path) return
    await run(async () => {
      if (isWeb) throw new Error('去码仅在桌面客户端可用')
      await startRestoreSmart(path)
    })
  }

  /** 区间去码：只处理指定的那一段（跑完自动播放） */
  async function rangeFile(id: number): Promise<void> {
    const path = filePath(id)
    if (!path) return
    await run(async () => {
      if (isWeb) throw new Error('去码仅在桌面客户端可用')
      await startRangeSmart(path)
    })
  }

  /** 边跑边看（追播）：起 lada 后把 m3u8 交给播放器 */
  async function watchLive(id: number): Promise<void> {
    if (isWeb) return
    const path = filePath(id)
    if (path) await startLive(path)
  }

  /** 整理指定文件（同一媒体库内可以多个） */
  async function organizeFiles(targets: AmaneFile[]): Promise<void> {
    const usable = targets.filter(file => file.metadata_id)
    if (!usable.length) {
      message.info('这些文件还没有刮削信息，整理会直接跳过它们（先去「刮削」）')
      return
    }
    if (!window.confirm(organizeFilesConfirm(usable))) return
    await run(async () => {
      await amaneRequest('/tasks', 'POST', {
        type: 'organize',
        library_id: usable[0].library_id,
        media_file_ids: usable.map(file => file.id),
      })
      message.success(`已加入整理队列（${usable.length} 条），去「任务」看结果`)
      ctx.switchTab('tasks')
    })
  }

  async function organizeFile(id: number): Promise<void> {
    const file = findFile(id)
    if (!file) {
      message.error('找不到该文件')
      return
    }
    await organizeFiles([file])
  }

  /** 整理整个媒体库：范围最大，会把库里所有**已刮削**的文件都按模板搬一遍 */
  async function organizeLibrary(library: AmaneLibrary): Promise<void> {
    if (!window.confirm(organizeLibraryConfirm(library.name))) return
    await run(async () => {
      await amaneRequest('/tasks', 'POST', {
        type: 'organize',
        library_id: library.id,
      })
      message.success('已加入整理队列（整个媒体库），去「任务」看结果')
      ctx.switchTab('tasks')
    })
  }

  /** 添加媒体库并立即扫描；成功返回 true（调用方据此清空表单） */
  async function addLibrary(input: LibraryInput): Promise<boolean> {
    let added = false
    await run(async () => {
      await amaneRequest('/libraries', 'POST', {
        name: input.name.trim() || null,
        path: input.path.trim(),
        automation: input.automation,
        auto_organize: false,
        scan: true,
      })
      added = true
      message.success('媒体库已添加，扫描任务已提交')
      await ctx.load()
    })
    return added
  }

  async function scanLibrary(
    library: AmaneLibrary,
    scrape: boolean
  ): Promise<void> {
    await run(async () => {
      await amaneRequest('/tasks', 'POST', {
        type: 'refresh',
        library_id: library.id,
        path: library.path,
        scan: ['add'],
        scrape: scrape ? ['pending', 'failed'] : [],
      })
      message.success(scrape ? '扫描和刮削任务已提交' : '扫描任务已提交')
    })
  }

  async function retryTask(id: number): Promise<void> {
    await run(async () => {
      await amaneRequest('/tasks/batch', 'POST', {
        action: 'retry',
        task_ids: [id],
      })
      await ctx.load()
    })
  }

  async function setWorker(paused: boolean): Promise<void> {
    await run(async () => {
      await amaneRequest(`/tasks/worker/${paused ? 'pause' : 'resume'}`, 'POST')
      ctx.workerPaused.value = paused
    })
  }

  return {
    restoreRunning,
    liveBusy,
    scrapeNumber,
    scrapeFilms,
    scrapeFile,
    play,
    restoreFile,
    rangeFile,
    watchLive,
    organizeFile,
    organizeLibrary,
    addLibrary,
    scanLibrary,
    retryTask,
    setWorker,
  }
}
