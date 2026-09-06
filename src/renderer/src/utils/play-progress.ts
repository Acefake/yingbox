import { readStoredArray, saveStoredArray } from '@/utils/storage'

const ONLINE_KEY = 'online_play_history'
const PROGRESS_MAP_KEY = 'media_play_progress'

type ProgressMap = Record<string, { progress: number; duration: number; updatedAt: number }>

function readProgressMap(): ProgressMap {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_MAP_KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as ProgressMap) : {}
  } catch {
    return {}
  }
}

function writeProgressMap(map: ProgressMap): void {
  try {
    localStorage.setItem(PROGRESS_MAP_KEY, JSON.stringify(map))
  } catch (error) {
    console.warn('[play-progress] map save failed', error)
  }
}

/** Prefer URL / filePath as stable key. */
export function mediaProgressKey(input: { url?: string; filePath?: string }): string {
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : ''
  return url || filePath
}

export function getMediaProgress(key: string): number {
  if (!key) return 0
  const mapped = readProgressMap()[key]?.progress
  if (typeof mapped === 'number' && mapped > 0) return mapped
  const history = readStoredArray<Record<string, any>>(ONLINE_KEY)
  const hit = history.find(entry => entry?.url === key)
  return typeof hit?.progress === 'number' ? hit.progress : 0
}

export function saveMediaProgress(
  key: string,
  progress: number,
  duration = 0
): void {
  if (!key) return
  if (!Number.isFinite(progress) || progress < 0) return

  const map = readProgressMap()
  map[key] = {
    progress,
    duration: Number.isFinite(duration) ? duration : 0,
    updatedAt: Date.now(),
  }
  // keep map bounded
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 80)
  writeProgressMap(Object.fromEntries(entries))

  const history = readStoredArray<Record<string, any>>(ONLINE_KEY)
  const index = history.findIndex(entry => entry?.url === key)
  if (index < 0) return
  const next = {
    ...history[index],
    progress,
    duration: Number.isFinite(duration) ? duration : history[index].duration || 0,
    timestamp: Date.now(),
  }
  const rest = history.filter((_, i) => i !== index)
  saveStoredArray(ONLINE_KEY, [next, ...rest].slice(0, 30))
}