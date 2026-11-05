/**
 * 选集：面板开关、每集显示名，以及「跳到第 N 集」。
 * 切集本身（解析地址、加载）由会话的 load 完成，这里只改队列位置。
 */
import { type Ref, computed, ref } from 'vue'

import type { PlaylistEntry } from '../utils/play-queue'

export interface UseEpisodePickerInput {
  playlist: Ref<PlaylistEntry[]>
  position: Ref<number>
  activeFallback: Ref<number>
  label: (entry: PlaylistEntry) => string
  /** 切集前落盘本集进度 */
  flush: () => void
  load: () => Promise<void>
}

export interface UseEpisodePickerReturn {
  open: Ref<boolean>
  labels: Readonly<Ref<string[]>>
  /** 控制栏「选集」按钮的动作；只有一集为 null（装按钮时读一次） */
  toggle: () => (() => void) | null
  jumpTo: (index: number) => Promise<void>
}

export function useEpisodePicker(
  input: UseEpisodePickerInput
): UseEpisodePickerReturn {
  const open = ref(false)
  const labels = computed(() =>
    input.playlist.value.map(
      (entry, i) => input.label(entry) || `第 ${i + 1} 集`
    )
  )

  const jumpTo = async (index: number): Promise<void> => {
    open.value = false
    if (index === input.position.value || !input.playlist.value[index]) return
    input.flush()
    input.activeFallback.value = -1
    input.position.value = index
    await input.load()
  }

  const toggle = (): (() => void) | null =>
    input.playlist.value.length > 1
      ? () => {
          open.value = !open.value
        }
      : null

  return { open, labels, toggle, jumpTo }
}
