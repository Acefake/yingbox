/**
 * FC2 コンテンツマーケット（adult.contents.fc2.com）：FC2-PPV 番号直接对应 /article/<数字>/ 商品页。
 *
 * 标题取 og:title（页面 h3 里混有防抓取的隐藏文字和促销标签）；卖家记为制作商；
 * 封面取 og:image 原图，海报取商品主图缩略图，剧照取「サンプル画像」原图链接。
 * 商品已下架时页面标题是「お探しの商品が見つかりませんでした」，按没有处理。
 * 行为参考 Amane 的 fc2 爬虫，代码独立实现。
 */
import { load } from '../../../../../shared/html/cheerio'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, minutesOf, unique } from '../html'
import type { JavRecord, JavSite, SiteContext } from '../types'

export const FC2_BASE = 'https://adult.contents.fc2.com'

/** FC2-PPV-1234567 → 1234567；不是 FC2 番号返回 undefined。 */
export function fc2Id(code: string): string | undefined {
  return /^FC2-PPV-(\d{5,8})$/i.exec(code)?.[1]
}

/** 解析商品页；下架 / 不存在返回 null。 */
export function parseFc2Article(
  html: string,
  url: string,
  id: string
): JavRecord | null {
  const $ = load(html)
  const meta = (name: string): string | undefined =>
    clean(
      $(`meta[property="${name}"]`).attr('content') ??
        $(`meta[name="${name}"]`).attr('content')
    )
  const ogTitle = meta('og:title')
  if (!ogTitle) return null
  const prefix = new RegExp(`^FC2-PPV-${id}\\s*`, 'i')
  const title = clean(ogTitle.replace(prefix, ''))
  if (!title) return null
  const overview = clean(meta('description')?.replace(prefix, ''))
  const released = $('.items_article_softDevice p')
    .map((_, p) => $(p).text())
    .get()
    .find(text => /販売日|販売開始日|上架时间/.test(text))
  return {
    site: 'fc2',
    code: `FC2-PPV-${id}`,
    url,
    title,
    releaseDate: dateOf(released),
    runtimeMinutes: minutesOf(
      clean(
        $('.items_article_MainitemThumb .items_article_info').first().text()
      )
    ),
    studio: clean($('a[data-article-seller-name]').first().text()),
    tags: unique(
      $('a.tagTag')
        .map((_, a) => clean($(a).text()))
        .get()
    ),
    actors: [],
    overview,
    cover: absolute(url, meta('og:image')),
    poster: absolute(
      url,
      $('.items_article_MainitemThumb img').first().attr('src')
    ),
    stills: unique(
      $('.items_article_SampleImagesArea a')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
    ),
  }
}

/** FC2 站点。 */
export const fc2: JavSite = {
  id: 'fc2',
  supports: kind => kind === 'fc2',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const id = fc2Id(target.code)
    if (!id) return null
    const url = `${FC2_BASE}/article/${id}/`
    const html = await ctx.page(url)
    return html ? parseFc2Article(html, url, id) : null
  },
}
