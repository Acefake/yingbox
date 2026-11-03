/**
 * view.resume：一条继续观看记录 → 接着播所需的剧集、当前集和起始秒数（ADR-0030、ADR-0031）。
 * 安卓开播时先登记记录（playback.continueStart），再用它取续播位置：同一集已有进度就从那里接着播。
 */
import { asRecord, asText } from '../../shared/json'
import type { ContinueRecord } from '../../shared/playback/continue-rules'
import type { ViewEpisode, ViewResume } from '../../shared/view/detail'

/** 安卓登记记录时 detail 里放的豆瓣身份 */
function doubanOf(detail: unknown): Pick<ViewResume, 'doubanId' | 'kind'> {
  const d = asRecord(detail)
  const id = asText(d?.doubanId)
  const kind = d?.kind === 'movie' || d?.kind === 'tv' ? d.kind : null
  return /^\d{1,12}$/.test(id)
    ? { doubanId: id, kind }
    : { doubanId: null, kind: null }
}

export function resumeView(record: ContinueRecord): ViewResume | null {
  const playlist = record.replay.playlist?.length
    ? record.replay.playlist
    : record.replay.url
      ? [{ url: record.replay.url, name: record.episode }]
      : []
  // 不过滤没有地址的条目：replay.index 指向原列表，过滤会让下标错位；空地址由 resolve 报「解析不到」
  const episodes: ViewEpisode[] = playlist.map(entry => ({
    name: entry.name ?? '',
    url: entry.url ?? '',
    siteName: entry.siteName ?? null,
    ext: entry.ext ? JSON.stringify(entry.ext) : null,
  }))
  if (!episodes.length) return null
  const index = Math.min(
    Math.max(0, record.replay.index ?? 0),
    episodes.length - 1
  )
  return {
    continueId: record.id,
    title: record.title,
    key: record.key,
    cover: record.cover ?? null,
    episodes,
    index,
    startAt: record.nextUp ? 0 : record.progress,
    ...doubanOf(record.detail),
  }
}
