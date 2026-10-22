/**
 * DMM 图床的地址规则（详情页、GraphQL、Affiliate、r18.dev 等来源共用），移植自 Amane 的 dmm_cdn。
 *
 * 同一份图在两个图床：
 * - 标准图床 pics.dmm.co.jp：ps.jpg 竖版海报只有 147×200，pl.jpg 横版封面 800×538；
 * - 高清图床 awsimgsrc.dmm.co.jp/pics_dig：较新的片 ps.jpg 是原生高清竖版海报（如 1032×1468），
 *   pl.jpg 也更大（如 2184×1468）。老片在高清图床与标准图床同尺寸，个别条目反而更小或缺图（404）。
 * 所以高清地址排前、标准地址兜底，由下载 / 探测按序回退；标准图床缺图时 302 到占位图（见 images/placeholder.ts）。
 *
 * 路径差别：mono（DVD）地址在 cid 前多一层分类目录（adult / amateur …），高清图床只认省去这层的路径；
 * digital/video、digital/amateur 路径原样；其余分类（电子书等）高清图床没有副本。
 */

/** 标准图床。 */
export const PICS_CDN = 'https://pics.dmm.co.jp'
/** 高清图床。 */
export const HIGH_RES_CDN = 'https://awsimgsrc.dmm.co.jp/pics_dig'

const COVER_SUFFIX = 'pl.jpg'
const POSTER_SUFFIX = 'ps.jpg'
const DIGITAL_PREFIXES = ['digital/video/', 'digital/amateur/']
const MONO_PREFIX = 'mono/movie/'

const onCdn = (url: string): boolean =>
  url.startsWith(`${PICS_CDN}/`) || url.startsWith(`${HIGH_RES_CDN}/`)

/** 去掉图床的缩放查询串与片段（高清图床按查询串返回缩小图）；非 DMM 地址原样返回。 */
export function stripTransform(url: string): string {
  return onCdn(url) ? url.split(/[?#]/, 1)[0] : url
}

/** 标准图床地址 → 高清图床地址；非标准图床或该分类没有高清副本时 undefined。 */
export function highResUrl(picsUrl: string): string | undefined {
  if (!picsUrl.startsWith(`${PICS_CDN}/`)) return undefined
  const path = picsUrl.slice(PICS_CDN.length + 1)
  if (path.startsWith(MONO_PREFIX)) {
    const segments = path.slice(MONO_PREFIX.length).split('/')
    const canonical =
      segments.length > 2 ? segments.slice(-2).join('/') : segments.join('/')
    return `${HIGH_RES_CDN}/${MONO_PREFIX}${canonical}`
  }
  if (DIGITAL_PREFIXES.some(p => path.startsWith(p)))
    return `${HIGH_RES_CDN}/${path}`
  return undefined
}

/** 图片地址 → 候选列表：高清在前、标准兜底；已是高清地址或非 DMM 地址只有它自己。 */
export function imageCandidates(url: string): string[] {
  const clean = stripTransform(url)
  const high = highResUrl(clean)
  return high ? [high, clean] : [clean]
}

/** pl.jpg 形态的封面 → 同一部片的竖版海报候选（高清在前）；不是 pl 形态时为空。 */
export function posterCandidates(coverUrl: string): string[] {
  const clean = stripTransform(coverUrl)
  if (!onCdn(clean) || !clean.endsWith(COVER_SUFFIX)) return []
  return imageCandidates(
    `${clean.slice(0, -COVER_SUFFIX.length)}${POSTER_SUFFIX}`
  )
}
