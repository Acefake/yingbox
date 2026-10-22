/**
 * GIGA 官网（www.giga-web.jp，特撮ヒロイン系）：站内检索 → 商品页，逐条核对「作品番号」。
 *
 * 反爬要点：
 * - 年龄确认存在服务端会话里：访问入口 /cookie_set.php（302）时站点下发 PHPSESSID 与负载均衡粘性 Cookie WSLB，
 *   之后的请求都要带上这一组 Cookie；固定 Cookie（old_check=yes 之类）无效。没有会话时检索页和商品页都换成年龄页（仍是 200）。
 *   请求带着旧会话访问入口时站点只回 PHPSESSID=deleted，所以领取最多试两次。
 * - 站内请求必须带 Referer，否则都回首页。
 * - 会话是这个站点对象里的一份共享状态：请求串行发出，命中年龄页时重领一次再试，仍是年龄页就报错（与「查无此片」区分）。
 * - 检索对编号的前导零敏感：站点写 GHKR-60，查 GHKR-060 没有结果，所以先查去掉前导零的写法。
 * 领取会话要读响应的 Set-Cookie，通用的 SiteContext.page 拿不到，宿主需另外提供 issuedCookies（见 CookieContext）。
 * 只查前缀表里的 GIGA 番号，其它番号不发请求。
 * 行为参考 Amane 的 giga 爬虫，代码独立实现。
 */
import { load } from '../../../../../shared/html/cheerio'
import { codeKey } from '../number'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, minutesOf, unique } from '../html'
import type {
  JavRecord,
  JavSite,
  JavSiteId,
  PageOptions,
  SiteContext,
} from '../types'

export const GIGA_BASE = 'https://www.giga-web.jp'

const SITE_ID = 'giga' as JavSiteId

/** 年龄确认入口。 */
const AGE_GATE_ENTRY = `${GIGA_BASE}/cookie_set.php`

/** 站内请求都要带的 Referer。 */
const REFERER = { Referer: `${GIGA_BASE}/` }

/** 最多核对几条检索结果。 */
const MAX_CANDIDATES = 3

/** GIGA 的番号前缀：GH 开头的系列，以及几条不以 GH 开头的老系列。 */
const GIGA_PREFIX =
  /^(?:GH[A-Z]{2}|GT[A-Z]{2}|GI[A-Z]{2}|THPA|JMSZ|SPSC|SPSA|SPSB|TGGP)$/

/** 宿主额外提供的能力：发一次不跟随重定向的 GET，返回响应 Set-Cookie 的 `name=value` 列表（不含属性）。 */
export interface CookieContext extends SiteContext {
  issuedCookies(url: string, options?: PageOptions): Promise<string[]>
}

const hasCookies = (ctx: SiteContext): ctx is CookieContext =>
  typeof (ctx as Partial<CookieContext>).issuedCookies === 'function'

/** 是不是 GIGA 番号。 */
export function isGigaCode(code: string): boolean {
  const prefix = /^([A-Z]+)-\d+$/.exec(code.toUpperCase())?.[1]
  return prefix !== undefined && GIGA_PREFIX.test(prefix)
}

/** 检索用的关键词：先去掉编号前导零（GHKR-060 → GHKR-60），再试原写法。 */
export function gigaKeywords(code: string): string[] {
  const m = /^([A-Z]+)-(\d+)$/i.exec(code)
  if (!m) return [code]
  return unique([`${m[1].toUpperCase()}-${Number(m[2])}`, code.toUpperCase()])
}

/** 入口下发的 Cookie → 会话 Cookie 头；没有拿到新 PHPSESSID 返回 undefined。 */
export function gigaSession(issued: readonly string[]): string | undefined {
  const live = issued
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('=') && !/=deleted$/i.test(c))
  return live.some(c => c.startsWith('PHPSESSID='))
    ? live.join('; ')
    : undefined
}

/** 页面是不是年龄页（整页换成确认表单，带指向入口的「はい」链接）。 */
export function isGigaAgeGate(html: string): boolean {
  return load(html)('a[href*="cookie_set.php"]').length > 0
}

/** 检索页 → 商品页地址列表。 */
export function parseGigaSearch(html: string): string[] {
  const $ = load(html)
  return unique(
    $('.thumBox a[href*="/product/index.php"]')
      .map((_, a) => absolute(GIGA_BASE, $(a).attr('href')))
      .get()
  )
}

/** 解析商品页；没有标题或作品番号与 expected 对不上返回 null。 */
export function parseGigaDetail(
  html: string,
  url: string,
  expected: string
): JavRecord | null {
  const $ = load(html)
  /** 作品信息里 <dt>标签</dt><dd>值</dd> 的 dd。 */
  const dd = (label: string): ReturnType<typeof $> =>
    $('#works_txt dl')
      .filter((_, dl) => clean($(dl).children('dt').text()) === label)
      .first()
      .children('dd')
  const title = clean($('#works_pic h5').first().text())
  const pageCode = clean(dd('作品番号').text())
  if (!title || !pageCode || codeKey(pageCode) !== codeKey(expected)) {
    return null
  }
  // 简介有折叠版（eye_list1，截断）和展开版（eye_list2），取展开版
  const stories = $('#eye_list2 .story_window')
  const story = (stories.length ? stories : $('.story_window')).first().clone()
  story.find('span').remove()
  // 封面图：pac_s 是竖版封套（海报），同目录的 pac_l 是横版整幅
  const poster = absolute(url, $('#works_pic img').first().attr('src'))
  return {
    site: SITE_ID,
    code: pageCode,
    url,
    title,
    releaseDate: dateOf(dd('DVDリリース日').text()),
    runtimeMinutes: minutesOf(dd('収録時間').text()),
    director: clean(
      dd('監督')
        .text()
        .replace(/[、,]\s*$/, '')
    ),
    studio: 'GIGA',
    tags: [],
    actors: unique(
      dd('出演女優')
        .find('a[href*="actor_id"]')
        .map((_, a) => clean($(a).text()))
        .get()
    ).map(name => ({ name })),
    overview: clean(story.text()),
    cover: poster?.replace(/\/pac_s\.jpg$/, '/pac_l.jpg'),
    poster,
    stills: unique(
      $('.gasatsu_images_pc a')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
    ),
  }
}

/** 生成 GIGA 站点（会话状态归这个对象所有；测试可各自新建）。 */
export function createGigaSite(): JavSite {
  let session: string | undefined
  let tail: Promise<unknown> = Promise.resolve()

  /** 串行执行：同一时刻只有一个请求在途，避免并发请求互相覆盖会话。 */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }

  /** 经入口领取会话；最多两次（第一次可能只是删掉旧会话）。 */
  async function claim(ctx: CookieContext): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = gigaSession(
        await ctx.issuedCookies(AGE_GATE_ENTRY, { headers: REFERER })
      )
      if (fresh) return fresh
    }
    throw new Error('giga 年龄确认入口没有下发会话')
  }

  /** 带会话取页；命中年龄页时重领一次再试。 */
  function get(url: string, ctx: CookieContext): Promise<string | null> {
    return serial(async () => {
      session ??= await claim(ctx)
      const options = (): PageOptions => ({ cookie: session, headers: REFERER })
      const html = await ctx.page(url, options())
      if (html === null || !isGigaAgeGate(html)) return html
      session = await claim(ctx)
      const retry = await ctx.page(url, options())
      if (retry !== null && isGigaAgeGate(retry)) {
        session = undefined
        throw new Error('giga 年龄确认会话未被站点接受')
      }
      return retry
    })
  }

  return {
    id: SITE_ID,
    supports: kind => kind === 'censored',
    async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
      if (!isGigaCode(target.code)) return null
      if (!hasCookies(ctx)) {
        throw new Error('giga 需要宿主提供 issuedCookies 才能领取年龄确认会话')
      }
      for (const keyword of gigaKeywords(target.code)) {
        const search = await get(
          `${GIGA_BASE}/search/?keyword=${encodeURIComponent(keyword)}`,
          ctx
        )
        const urls = search ? parseGigaSearch(search) : []
        if (!urls.length) continue
        for (const url of urls.slice(0, MAX_CANDIDATES)) {
          const html = await get(url, ctx)
          const record = html ? parseGigaDetail(html, url, target.code) : null
          if (record) return record
        }
        return null
      }
      return null
    },
  }
}

/** GIGA 站点。 */
export const giga = createGigaSite()
