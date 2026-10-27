/**
 * 打开设置 · 自动追更分区（追更面板、电影追踪面板的「策略」按钮用）。sub 是分区里要定位的种类。
 */

/** 打开设置 · 自动追更，定位到剧集或电影 */
export function openAutograbSettings(kind: 'tv' | 'movie'): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: `autograb:${kind}` })
  )
}
