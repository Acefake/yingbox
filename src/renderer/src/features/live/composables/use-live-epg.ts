/**
 * 直播节目单：频道或节目单地址变化后（防抖）让主进程加载 XMLTV，再按频道取今天的节目。
 * 多个节目单时先到先得：前一个节目单已有某频道，后面的不再覆盖。
 * now 每 30 秒走一次，驱动「当前节目」与进度条。
 */
import { type Ref, onScopeDispose, ref, shallowRef, watch } from 'vue'

import type { LiveChannel } from '../utils/playlist-parse'
import { todayRange } from '../utils/epg-rules'
import {
  EPG_QUERY_LIMIT,
  type EpgProgramme,
  type EpgQuery,
} from '../../../../../shared/contract/iptv'

const TICK_MS = 30_000
const DEBOUNCE_MS = 400
/** 查询范围比今天多出的余量：跨零点的节目也能拿到 */
const MARGIN_MS = 6 * 60 * 60 * 1000

/** 频道 → 节目单查询条件（普通对象，可直接过 IPC） */
export function toEpgQuery(channel: LiveChannel): EpgQuery {
  const names = [channel.name, channel.tvgName].filter((n): n is string => !!n)
  return { key: channel.id, tvgId: channel.tvgId, names }
}

/** 订阅节目单；在组件 setup 里调用，卸载时停止计时 */
export function useLiveEpg(
  channels: Readonly<Ref<LiveChannel[]>>,
  epgUrls: Readonly<Ref<string[]>>
): {
  programmes: Readonly<Ref<Record<string, EpgProgramme[]>>>
  now: Readonly<Ref<number>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<string>>
  reload: (force: boolean) => Promise<void>
} {
  const programmes = shallowRef<Record<string, EpgProgramme[]>>({})
  const now = ref(Date.now())
  const loading = ref(false)
  const error = ref('')
  let token = 0

  const reload = async (force: boolean): Promise<void> => {
    const iptv = window.api?.iptv
    const urls = [...epgUrls.value]
    const run = ++token
    if (!iptv || !urls.length || !channels.value.length) {
      programmes.value = {}
      error.value = ''
      return
    }
    loading.value = true
    const queries = channels.value.map(toEpgQuery)
    const { from, to } = todayRange(Date.now())
    const merged: Record<string, EpgProgramme[]> = {}
    const failures: string[] = []
    for (const url of urls) {
      const loaded = await iptv.loadEpg(url, force)
      if (!loaded.ok) {
        failures.push(loaded.error || url)
        continue
      }
      for (let i = 0; i < queries.length; i += EPG_QUERY_LIMIT) {
        const result = await iptv.epgProgrammes(
          url,
          queries.slice(i, i + EPG_QUERY_LIMIT),
          from - MARGIN_MS,
          to + MARGIN_MS
        )
        if (!result.ok || !result.data) continue
        for (const [key, list] of Object.entries(result.data))
          merged[key] ??= list
      }
    }
    if (run !== token) return
    programmes.value = merged
    error.value = failures.length ? `节目单加载失败：${failures[0]}` : ''
    loading.value = false
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    [channels, epgUrls],
    () => {
      clearTimeout(timer)
      timer = setTimeout(() => void reload(false), DEBOUNCE_MS)
    },
    { immediate: true }
  )

  const tick = setInterval(() => {
    const before = todayRange(now.value).from
    now.value = Date.now()
    // 过了零点：重新取「今天」的节目
    if (todayRange(now.value).from !== before) void reload(false)
  }, TICK_MS)

  onScopeDispose(() => {
    clearTimeout(timer)
    clearInterval(tick)
    token++
  })

  return { programmes, now, loading, error, reload }
}
