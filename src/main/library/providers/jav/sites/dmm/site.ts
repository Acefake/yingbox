/**
 * DMM / FANZA 站点：番号 → cid，先走 GraphQL（配信版），查不到再走网页检索兜底（DVD 版）。
 *
 * 请求预算（一部片）：
 * 1. GraphQL「猜测 cid 取详情 + 同词检索」一次；猜中即结束（绝大多数有码作品）；
 * 2. 猜不中但检索到带前缀的 cid（1stars00100）→ 再取一次详情；
 * 3. 都没有 → 网页检索页一次，命中 DVD 详情再取一次。网页在日本以外会被地区限制：
 *    GraphQL 已明确答复「没有」时，网页被拦按查无此片处理（GraphQL 对配信版是权威的）；
 *    GraphQL 本身失败而网页也被拦时抛错，交给上层记失败、不缓存。
 * 行为参考 Amane 的 dmm 爬虫，代码独立实现。
 */
import type { JavCode, JavCodeKind } from '../../number'
import type { JavRecord, JavSite, SiteContext } from '../../types'
import { type DmmCid, dmmCid, pickCid } from './cid'
import {
  DMM_GRAPHQL,
  type DmmGraphqlResult,
  contentRequest,
  dmmContentRecord,
  lookupRequest,
  parseGraphql,
} from './graphql'
import {
  DMM_WEB_OPTIONS,
  categoryOf,
  cidOfUrl,
  dmmSearchUrl,
  isRegionBlocked,
  parseDmmMono,
  pickDmmSearch,
} from './web'

/** 发一次 GraphQL 请求并解析。 */
async function graphql(
  ctx: SiteContext,
  options: ReturnType<typeof lookupRequest>
): Promise<DmmGraphqlResult> {
  const text = await ctx.page(DMM_GRAPHQL, options)
  if (text === null) throw new Error('DMM GraphQL 接口不存在（404）')
  return parseGraphql(text)
}

/** GraphQL 路线：猜测 cid → 检索兜底。查无此片返回 null。 */
async function viaGraphql(
  cid: DmmCid,
  kind: JavCodeKind,
  ctx: SiteContext
): Promise<JavRecord | null> {
  const first = await graphql(
    ctx,
    lookupRequest(cid.padded, kind === 'amateur' ? null : 'AV')
  )
  if (first.content) {
    const record = dmmContentRecord(first.content)
    if (record) return record
  }
  const found = pickCid(first.searchIds, cid)
  if (!found || found === first.content?.id) return null
  const second = await graphql(ctx, contentRequest(found))
  return second.content ? dmmContentRecord(second.content) : null
}

/** 网页路线：检索页 → 配信版交给 GraphQL，DVD 版解析详情页。查无此片返回 null，被地区限制抛错。 */
async function viaWeb(
  cid: DmmCid,
  ctx: SiteContext
): Promise<JavRecord | null> {
  const search = await ctx.page(dmmSearchUrl(cid), DMM_WEB_OPTIONS)
  if (search === null) return null
  if (isRegionBlocked(search))
    throw new Error('DMM 网页限制了当前地区（需要日本出口）')
  const url = pickDmmSearch(search, cid)
  if (!url) return null
  const id = cidOfUrl(url)
  if (categoryOf(url) === 'digital' && id) {
    const result = await graphql(ctx, contentRequest(id))
    return result.content ? dmmContentRecord(result.content) : null
  }
  const detail = await ctx.page(url, DMM_WEB_OPTIONS)
  return detail ? parseDmmMono(detail, url) : null
}

/** DMM / FANZA 站点。 */
export const dmm: JavSite = {
  id: 'dmm',
  supports: kind => kind === 'censored' || kind === 'amateur',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const cid = dmmCid(target.code)
    if (!cid) return null
    let graphqlError: unknown
    try {
      const record = await viaGraphql(cid, target.kind, ctx)
      if (record) return record
    } catch (error) {
      if (ctx.signal?.aborted) throw error
      graphqlError = error
    }
    // 素人作品几乎没有 DVD 版，不再多发网页请求
    if (target.kind === 'amateur') {
      if (graphqlError) throw graphqlError
      return null
    }
    try {
      return await viaWeb(cid, ctx)
    } catch (error) {
      if (ctx.signal?.aborted || graphqlError) throw graphqlError ?? error
      return null
    }
  },
}
