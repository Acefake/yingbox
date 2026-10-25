/**
 * 直播源与收藏的状态（模块单例，离开直播页再回来不重新拉取）。
 *
 * 源列表与收藏存在 @/utils/storage；播放列表原文经 window.api.iptv 由主进程读取（远程走 http-client），
 * 解析在渲染层用纯函数完成，结果只留在内存。Web 版没有 iptv 域，available 为 false。
 */
import { computed, ref, shallowRef } from 'vue'

import { readStoredArray, saveStoredArray } from '@/utils/storage'

import {
  type LiveSource,
  combineChannels,
  defaultSourceName,
  epgUrlsFor,
  isValidSourceUrl,
  newSourceId,
  sanitizeSource,
  toggleFavorite,
} from '../utils/live-rules'
import { type ParsedPlaylist, parsePlaylist } from '../utils/playlist-parse'
import type { PlaylistText } from '../../../../../shared/contract/iptv'

const SOURCES_KEY = 'live_sources'
const FAVORITES_KEY = 'live_favorites'

const api = (): Window['api']['iptv'] | undefined =>
  typeof window !== 'undefined' ? window.api?.iptv : undefined

const sources = ref<LiveSource[]>(
  readStoredArray<unknown>(SOURCES_KEY)
    .map(sanitizeSource)
    .filter((s): s is LiveSource => s !== null)
)
const favorites = ref<string[]>(
  readStoredArray<string>(FAVORITES_KEY, v => typeof v === 'string')
)
/** 每个源的解析结果 */
const parsed = shallowRef<Record<string, ParsedPlaylist>>({})
/** 每个源最近一次加载的错误 */
const errors = ref<Record<string, string>>({})
/** 正在加载的源 */
const loading = ref<Record<string, boolean>>({})
let started = false

const persistSources = (): void => {
  saveStoredArray(
    SOURCES_KEY,
    sources.value.map(s => ({ ...s }))
  )
}

/** 读源原文（远程 / 本地） */
async function readSource(source: LiveSource): Promise<PlaylistText> {
  const iptv = api()
  if (!iptv) return { ok: false, error: '直播需要桌面端' }
  return source.kind === 'url'
    ? iptv.fetchPlaylist(source.location)
    : iptv.readPlaylistFile(source.location)
}

/** 解析原文并记下结果或错误 */
function applyText(id: string, result: PlaylistText): boolean {
  const nextErrors = { ...errors.value }
  delete nextErrors[id]
  if (!result.ok || result.text === undefined) {
    nextErrors[id] = result.error || '读取失败'
    errors.value = nextErrors
    return false
  }
  const playlist = parsePlaylist(result.text)
  if (!playlist.channels.length) {
    nextErrors[id] = '没有解析到可播放的频道'
    errors.value = nextErrors
    return false
  }
  parsed.value = { ...parsed.value, [id]: playlist }
  errors.value = nextErrors
  return true
}

/** 重新拉取并解析一个源 */
async function refresh(id: string): Promise<boolean> {
  const source = sources.value.find(s => s.id === id)
  if (!source || loading.value[id]) return false
  loading.value = { ...loading.value, [id]: true }
  try {
    return applyText(id, await readSource(source))
  } finally {
    const next = { ...loading.value }
    delete next[id]
    loading.value = next
  }
}

/** 刷新全部启用的源 */
async function refreshAll(): Promise<void> {
  await Promise.all(
    sources.value.filter(s => s.enabled).map(s => refresh(s.id))
  )
}

/** 首次进入直播页：加载所有启用的源 */
function ensureStarted(): void {
  if (started || !api()) return
  started = true
  void refreshAll()
}

/**
 * 添加远程源；地址非法或重复时返回错误文案。
 * name 为空时用主机名 + 文件名（推荐源传自己的名称）。
 */
async function addUrl(
  url: string,
  epgUrl = '',
  name = ''
): Promise<string | null> {
  const location = url.trim()
  if (!isValidSourceUrl(location)) return '请输入 http / https 地址'
  if (sources.value.some(s => s.kind === 'url' && s.location === location))
    return '这个直播源已经添加过了'
  const source: LiveSource = {
    id: newSourceId(),
    name: name.trim() || defaultSourceName(location),
    kind: 'url',
    location,
    epgUrl: epgUrl.trim(),
    enabled: true,
  }
  sources.value = [...sources.value, source]
  persistSources()
  await refresh(source.id)
  return null
}

/** 从对话框添加本地文件源；取消时返回 null */
async function addFile(): Promise<string | null> {
  const iptv = api()
  if (!iptv) return '直播需要桌面端'
  const picked = await iptv.pickPlaylistFile()
  if (picked.canceled || !picked.path) return picked.error ?? null
  const existing = sources.value.find(
    s => s.kind === 'file' && s.location === picked.path
  )
  const source: LiveSource = existing ?? {
    id: newSourceId(),
    name: picked.name || picked.path,
    kind: 'file',
    location: picked.path,
    epgUrl: '',
    enabled: true,
  }
  if (!existing) {
    sources.value = [...sources.value, source]
    persistSources()
  }
  applyText(source.id, picked)
  return null
}

/** 修改一个源的字段 */
function update(id: string, patch: Partial<Omit<LiveSource, 'id'>>): void {
  sources.value = sources.value.map(s => (s.id === id ? { ...s, ...patch } : s))
  persistSources()
}

/** 启用 / 禁用；启用时还没加载过就加载 */
function setEnabled(id: string, enabled: boolean): void {
  update(id, { enabled })
  if (enabled && !parsed.value[id]) void refresh(id)
}

/** 删除一个源 */
function remove(id: string): void {
  sources.value = sources.value.filter(s => s.id !== id)
  persistSources()
  const next = { ...parsed.value }
  delete next[id]
  parsed.value = next
}

/** 收藏 / 取消收藏频道 */
function toggleFavoriteChannel(id: string): void {
  favorites.value = toggleFavorite(favorites.value, id)
  saveStoredArray(FAVORITES_KEY, [...favorites.value])
}

/** 启用的源合并后的频道 */
const channels = computed(() =>
  combineChannels(
    sources.value
      .filter(s => s.enabled)
      .map(s => parsed.value[s.id]?.channels ?? [])
  )
)

/** 启用的源要用到的节目单地址（去重） */
const epgUrls = computed(() => {
  const urls = sources.value
    .filter(s => s.enabled && parsed.value[s.id])
    .flatMap(s => epgUrlsFor(s, parsed.value[s.id].epgUrls))
  return [...new Set(urls)]
})

const favoriteSet = computed(() => new Set(favorites.value))
const anyLoading = computed(() => Object.keys(loading.value).length > 0)

const liveSources = {
  available: Boolean(api()),
  sources,
  parsed,
  errors,
  loading,
  anyLoading,
  channels,
  epgUrls,
  favorites: favoriteSet,
  ensureStarted,
  refresh,
  refreshAll,
  addUrl,
  addFile,
  update,
  setEnabled,
  remove,
  toggleFavorite: toggleFavoriteChannel,
}

/** 直播源状态与操作 */
export function useLiveSources(): typeof liveSources {
  return liveSources
}
