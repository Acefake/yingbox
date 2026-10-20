/**
 * 临时过渡层：影视库重构合并（影视代码改用 getSetting）后删除本文件，并去掉 main.ts 里的调用。
 *
 * 影视库（views/Movie、views/TV、api/tmdb、stores/scrape-provider-store 等）仍直接读 localStorage 里的旧键，
 * 本文件把新设置层的值单向镜像回这些同名键，让影视代码零改动继续工作。
 * 只镜像设置，不碰影视的数据键（tvFileData、tvDirectories、folderContent_* 等）。
 */
import { watchEffect } from 'vue'
import { getSetting } from './use-setting'

/** 写 scrapeProviderConfig 时保留影视代码可能写入的其它字段 */
function mergeProviderConfig(next: Record<string, string>): string {
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(localStorage.getItem('scrapeProviderConfig') || '{}')
  } catch {
    /* 损坏时整份覆盖 */
  }
  return JSON.stringify({ ...current, ...next })
}

/** 立即镜像一次，之后设置每变一次就同步一次 */
export function startLegacyLibraryMirror(): void {
  watchEffect(() => {
    localStorage.setItem(
      'metadataLanguage',
      getSetting('scrape.metadataLanguage')
    )
    localStorage.setItem(
      'scrapeConcurrency',
      String(getSetting('scrape.concurrency'))
    )
    localStorage.setItem(
      'imageDownloadSize_poster',
      getSetting('scrape.imageSize.poster')
    )
    localStorage.setItem(
      'imageDownloadSize_backdrop',
      getSetting('scrape.imageSize.backdrop')
    )
    localStorage.setItem(
      'imageDownloadSize_actor',
      getSetting('scrape.imageSize.actor')
    )
    localStorage.setItem(
      'scrapeProviderConfig',
      mergeProviderConfig({
        provider: getSetting('scrape.provider'),
        tmdbAccessToken: getSetting('scrape.tmdbToken'),
        customProviderName: getSetting('scrape.customName'),
        customBaseUrl: getSetting('scrape.customBaseUrl'),
        customApiKey: getSetting('scrape.customApiKey'),
        goBackendUrl: getSetting('backend.url'),
        goBackendApiKey: getSetting('backend.apiKey'),
      })
    )
  })
}
