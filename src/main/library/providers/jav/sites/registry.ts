/**
 * 内置番号站点注册表：全部站点实现，连同需要用户凭据的站点（ThePornDB 令牌、JavDB 登录 Cookie、
 * DMM 官方 API 凭据）在这里一次接好。凭据每次查询时现读，用户改设置后立即生效。
 *
 * 顺序无意义：优先级与开关由设置（JAV_SITES / JavSettings）决定，这里只按 id 提供实现。
 */
import type { JavSite } from '../types'
import { airav } from './airav'
import { avbase } from './avbase'
import { avsox } from './avsox'
import { dahlia } from './dahlia'
import { type DmmApiCredentials, createDmmApi, dmm } from './dmm'
import { faleno } from './faleno'
import { fc2 } from './fc2'
import { fc2club } from './fc2club'
import { fc2ppvdb } from './fc2ppvdb'
import { freejavbt } from './freejavbt'
import { getchu } from './getchu'
import { giga } from './giga'
import { iqqtv } from './iqqtv'
import { jav321 } from './jav321'
import { javbus } from './javbus'
import { createJavdb } from './javdb'
import { javlibrary } from './javlibrary'
import { kin8 } from './kin8'
import { mgstage } from './mgstage'
import { official } from './official'
import { prestige } from './prestige'
import { r18dev } from './r18dev'
import { createThePornDb } from './theporndb'
import { xcity } from './xcity'

/** 站点要用的用户凭据；都是可选的，缺了对应站点自动跳过或降级。 */
export interface JavCredentials {
  /** ThePornDB API 令牌；没有就不查 ThePornDB。 */
  theporndbToken?: string
  /** JavDB 登录后的 Cookie（整段 name=value; ...）；有才查 FC2。 */
  javdbCookie?: string
  /** DMM 官方 API 凭据；没有就不查 dmm_api。 */
  dmmApi?: DmmApiCredentials
}

/** 按当前凭据创建全部站点实现。credentials 每次查询时调用。 */
export function createJavSites(
  credentials: () => JavCredentials = () => ({})
): readonly JavSite[] {
  return [
    javbus,
    dmm,
    avbase,
    r18dev,
    createJavdb({ cookie: () => credentials().javdbCookie }),
    official,
    prestige,
    faleno,
    dahlia,
    mgstage,
    xcity,
    giga,
    kin8,
    avsox,
    jav321,
    fc2,
    fc2ppvdb,
    javlibrary,
    iqqtv,
    airav,
    createThePornDb(() => credentials().theporndbToken),
    createDmmApi(() => credentials().dmmApi),
    freejavbt,
    getchu,
    fc2club,
  ]
}

/**
 * "API_ID:AFFILIATE_ID" → DMM 凭据；格式不对返回 undefined。
 * 设置里把两个值存成一个字符串，省一套键。
 */
export function parseDmmApiCredentials(
  value: string | undefined
): DmmApiCredentials | undefined {
  const [apiId, affiliateId] = (value ?? '').split(':').map(s => s.trim())
  return apiId && affiliateId ? { apiId, affiliateId } : undefined
}
