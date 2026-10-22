/**
 * 番号海报与封面选图：尽量拿到清晰的竖版海报（与 Amane 的做法一致）。
 *
 * 1. 封面：DMM 地址先试高清图床、再标准图床（见 sites/dmm/cdn.ts），取第一张探得到尺寸的；
 * 2. 有码片的海报候选：站点给的海报 + 由封面推出的 DMM ps.jpg，各自高清在前；
 *    第一张是竖图、且高度达到封面高度的 CROP_SKIP_RATIO（封面尺寸未知时 HD_POSTER_HEIGHT）就直接用——
 *    高清图床的 ps.jpg 通常就是原生高清海报，不用裁；
 * 3. 都不够：从封面裁右侧（images/derived.ts），站点海报排第二作兜底。无码 / FC2 / 素人不裁。
 *
 * 不注入探测时不做网络探测：有码片一律裁、地址原样用。
 */
import type { ImageProbe, ImageSize } from '../../images/image-size'
import type { JavMovie } from './aggregate'
import type { JavCode } from './number'
import { imageCandidates, posterCandidates } from './sites/dmm/cdn'

/** 封面尺寸未知时，站点海报高度达到它就算高清（封面裁出的海报高 538）。 */
export const HD_POSTER_HEIGHT = 500
/** 海报高度 / 封面高度达到它就不裁（裁剪有错位风险），与 Amane 的 poster_crop_skip_ratio 一致。 */
export const CROP_SKIP_RATIO = 0.9

/** 选图结果：改写过地址的影片，以及海报用原生图还是封面裁。 */
export interface PosterPlan {
  movie: JavMovie
  poster: 'native' | 'crop'
}

/** 按序探测，返回第一张探得到尺寸的地址。 */
async function firstReachable(
  urls: string[],
  probe: ImageProbe,
  signal?: AbortSignal
): Promise<{ url: string; size: ImageSize } | undefined> {
  for (const url of urls) {
    const size = await probe(url, signal)
    if (size) return { url, size }
  }
  return undefined
}

const unique = (urls: string[]): string[] => [...new Set(urls)]

/** 选封面与海报。 */
export async function planPoster(
  movie: JavMovie,
  code: JavCode,
  probe: ImageProbe | undefined,
  signal?: AbortSignal
): Promise<PosterPlan> {
  const censored = code.kind === 'censored' && Boolean(movie.cover)
  if (!probe) return { movie, poster: censored ? 'crop' : 'native' }

  const cover = movie.cover
    ? await firstReachable(imageCandidates(movie.cover), probe, signal)
    : undefined
  const next: JavMovie = { ...movie, cover: cover?.url ?? movie.cover }

  const candidates = unique([
    ...(movie.poster ? imageCandidates(movie.poster) : []),
    ...(movie.cover ? posterCandidates(movie.cover) : []),
  ])
  if (!censored) {
    const poster = await firstReachable(candidates, probe, signal)
    return {
      movie: { ...next, poster: poster?.url ?? movie.poster },
      poster: 'native',
    }
  }

  // 封面是横图时按它的高度比；封面尺寸未知或不是横图时用固定门槛
  const need =
    cover && cover.size.width > cover.size.height
      ? Math.round(cover.size.height * CROP_SKIP_RATIO)
      : HD_POSTER_HEIGHT
  let fallback: string | undefined
  for (const url of candidates) {
    const size = await probe(url, signal)
    if (!size) continue
    fallback ??= url
    // 个别站标成海报的其实是横图（如 MGStage 的 pb_e），不算
    if (size.height > size.width && size.height >= need) {
      return { movie: { ...next, poster: url }, poster: 'native' }
    }
  }
  return {
    movie: { ...next, poster: fallback ?? movie.poster },
    poster: 'crop',
  }
}
