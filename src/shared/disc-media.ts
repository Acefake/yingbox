/**
 * 内置播放器（Chromium）放不了的光盘类文件：光盘镜像、原盘 / DVD 的分段与 MPEG 节目流。
 * 这些文件只有 mpv 能播：播放路由（player/utils/playback-route.ts）遇到就直接交给 mpv，
 * 光盘镜像再由主进程按内容选 bluray:// 或 dvd://（main/mpv-disc.ts）。
 */

/** 光盘镜像。 */
const DISC_IMAGE_RE = /\.iso$/i
/** 内置播放器放不了的其它容器。 */
const MPV_ONLY_RE = /\.(?:m2ts|mts|vob|mpe?g)$/i

/** 路径是不是光盘镜像（.iso）。 */
export function isDiscImage(path: string | undefined): boolean {
  return !!path && DISC_IMAGE_RE.test(path)
}

/** 路径是不是只有 mpv 能播的文件（光盘镜像、m2ts / mts / vob / mpg）。远程地址带的查询串不影响判断。 */
export function needsMpv(path: string | undefined): boolean {
  if (!path) return false
  const bare = path.split(/[?#]/)[0]
  return DISC_IMAGE_RE.test(bare) || MPV_ONLY_RE.test(bare)
}
