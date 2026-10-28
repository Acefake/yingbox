/**
 * 把 Artplayer、hls.js、弹幕插件从共享 chunk 里拆出去。
 * 主窗口和 player.html 共用的模块会被 Rollup 合成一块（产物名 theme-*.js）并被 index.html modulepreload；
 * 这三个包只该跟着播放器异步块走。
 */
export function vendorPlayerManualChunk(id: string): string | undefined {
  const path = id.replaceAll('\\', '/')
  if (
    path.includes('/node_modules/artplayer-plugin-danmuku/') ||
    path.includes('/node_modules/artplayer/') ||
    path.includes('/node_modules/hls.js/')
  ) {
    return 'vendor-player'
  }
  return undefined
}
