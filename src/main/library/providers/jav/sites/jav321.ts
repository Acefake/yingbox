/**
 * JAV321（www.jav321.com）：FANZA 数据镜像。POST /search（表单 sn=<番号>），命中时 301 到 /video/<DMM 品番>，
 * fetch 跟随重定向后拿到的就是详情页；没有时返回一个空的搜索页。一次请求完成查询。
 *
 * - 详情页主面板 .panel-heading h3 是标题（<small> 里是番号和演员，去掉）；
 *   信息区是「<b>出演者</b>: <a>…</a><br><b>品番</b>: ssis-497<br>…」的扁平结构，按 <b> 标签切段；
 * - 「品番」是 DMM 写法：素人带数字前缀的（259LUXU-1234）这里没有前缀（luxu-1234），核对时容许；
 * - 简介是主面板第二个 .col-md-12 的直接文字（后面跟着的配信说明、特集链接不要）；
 * - 右栏第一张是横版封面（FANZA 的 pl / 素人厂牌的 pb），其余是剧照；主面板左侧是竖版小图（ps）；
 *   页面写的是 http:// 且偶有双斜杠，统一成 https 与单斜杠；
 * - 演员头像取「…によって行われる」面板里演员链接对应的图片（DMM actjpgs）；
 * - 详情页地址取页面里「简体中文」语言链接（重定向后拿不到最终 URL）。
 * 有码 / 素人；无码与 FC2 不在 FANZA，不查。
 */
import type { CheerioAPI } from 'cheerio'
import { load } from '../../../../../shared/html/cheerio'
import { codeKey } from '../number'
import type { JavCode } from '../number'
import {
  absolute,
  clean,
  dateOf,
  isPlaceholder,
  minutesOf,
  unique,
} from '../html'
import type {
  JavActor,
  JavRecord,
  JavSite,
  JavSiteId,
  PageOptions,
  SiteContext,
} from '../types'

/**
 * 走 http：站点的 HTTPS 证书 2026-10-14 已过期，https 请求会被拒绝；http 同样可用（只读公开页面，不带凭据）。
 * 证书续上后改回 https。
 */
export const JAV321_BASE = 'http://www.jav321.com'
const SITE_ID: JavSiteId = 'jav321'

/** 搜索请求：表单 POST。 */
export function jav321SearchOptions(code: string): PageOptions {
  return {
    method: 'POST',
    body: new URLSearchParams({ sn: code }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: JAV321_BASE,
      Referer: `${JAV321_BASE}/`,
    },
  }
}

/** 图片地址规整：外站图（DMM 等）http → https、站点自家图跟 JAV321_BASE 的协议，路径里的连续斜杠合一；占位图丢掉。 */
export function jav321Image(src: string | undefined): string | undefined {
  const url = absolute(JAV321_BASE, src)
  if (!url || isPlaceholder(url)) return undefined
  const parsed = new URL(url)
  parsed.protocol =
    parsed.hostname === new URL(JAV321_BASE).hostname
      ? new URL(JAV321_BASE).protocol
      : 'https:'
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/')
  return parsed.toString()
}

/** 信息区：<b>标签</b> 到下一个 <br> 之间的内容 → { 文字, 链接文字[] }。 */
interface InfoValue {
  text?: string
  links: string[]
}

function infoOf(
  $: CheerioAPI,
  main: ReturnType<CheerioAPI>
): Map<string, InfoValue> {
  const info = new Map<string, InfoValue>()
  main.find('.panel-body .col-md-9 > b').each((_, b) => {
    const label = clean($(b).text())
    if (!label) return
    let text = ''
    const links: string[] = []
    for (let node = b.nextSibling; node; node = node.nextSibling) {
      if (node.type === 'tag' && (node.name === 'br' || node.name === 'b'))
        break
      const piece = $(node).text()
      text += piece
      if (node.type === 'tag' && node.name === 'a') {
        const name = clean(piece)
        if (name) links.push(name)
      }
    }
    info.set(label, {
      text: clean(text.replace(/^\s*:/, '')),
      links: unique(links),
    })
  })
  return info
}

/**
 * 页面番号与目标番号是否同一部：归一后相等，或目标去掉素人数字前缀后相等。
 */
export function sameJav321Code(found: string, target: string): boolean {
  const a = codeKey(found)
  const b = codeKey(target)
  return a === b || a === b.replace(/^\d+/, '')
}

/**
 * 详情页地址：DMM 品番取自「简体中文」语言链接（//www.jav321.com/video/<品番>），
 * 没有时取剧照链接 /snapshot/<品番>/…；都没有退回搜索地址。
 */
function jav321DetailUrl($: CheerioAPI): string {
  const self = $('a[href*="www.jav321.com/video/"]').first().attr('href')
  const cid =
    (self && /\/video\/([^/?#]+)/.exec(self)?.[1]) ||
    /^\/snapshot\/([^/]+)\//.exec(
      $('a[href^="/snapshot/"]').first().attr('href') ?? ''
    )?.[1]
  return cid ? `${JAV321_BASE}/video/${cid}` : `${JAV321_BASE}/search`
}

/** 解析详情页；搜索落空（空搜索页）返回 null。 */
export function parseJav321Detail(html: string): JavRecord | null {
  const $ = load(html)
  const main = $('.panel-info').first()
  const heading = main.find('.panel-heading h3').first().clone()
  heading.find('small').remove()
  const title = clean(heading.text())
  const info = infoOf($, main)
  const code = info.get('品番')?.text?.toUpperCase()
  if (!title || !code) return null

  const url = jav321DetailUrl($)

  // 演员头像：演员面板里 /star/ 链接包着的图片
  const photos = new Map<string, string>()
  $('.thumbnail a[href^="/star/"]').each((_, a) => {
    const name = clean($(a).text())
    const photo = jav321Image($(a).find('img').attr('src'))
    if (name && photo) photos.set(name, photo)
  })
  const actors: JavActor[] = (info.get('出演者')?.links ?? []).map(name => ({
    name,
    ...(photos.has(name) ? { photo: photos.get(name) } : {}),
  }))

  const overviewNode = main.find('.panel-body > .row > .col-md-12').eq(1)
  const overview = clean(
    overviewNode
      .contents()
      .filter((_, n) => n.type === 'text')
      .text()
  )

  const gallery = unique(
    $('a[href^="/snapshot/"] img')
      .map((_, img) => jav321Image($(img).attr('src')))
      .get()
  )
  // 右栏第一张（/snapshot/<品番>/1/0）是封面：FANZA 是 pl 图，素人厂牌是自家的 pb 大图
  const [cover, ...stills] = gallery

  return {
    site: SITE_ID,
    code,
    url,
    title,
    releaseDate: dateOf(
      info.get('配信開始日')?.text ?? info.get('発売日')?.text
    ),
    runtimeMinutes: minutesOf(info.get('収録時間')?.text),
    studio: info.get('メーカー')?.links[0],
    series: info.get('シリーズ')?.links[0],
    tags: info.get('ジャンル')?.links ?? [],
    actors,
    overview,
    cover,
    poster: jav321Image(
      main.find('.panel-body .col-md-3 img').first().attr('src')
    ),
    stills,
  }
}

/** JAV321 站点。 */
export const jav321: JavSite = {
  id: SITE_ID,
  supports: kind => kind === 'censored' || kind === 'amateur',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const page = await ctx.page(
      `${JAV321_BASE}/search`,
      jav321SearchOptions(target.code)
    )
    const record = page ? parseJav321Detail(page) : null
    return record && sameJav321Code(record.code, target.code) ? record : null
  },
}
