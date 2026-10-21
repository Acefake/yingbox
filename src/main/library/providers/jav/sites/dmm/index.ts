/**
 * DMM 系站点：dmm（FANZA GraphQL + 网页兜底）与 dmm_api（官方商品情报 API，需要凭据）。
 * cid 规则见 cid.ts，GraphQL 见 graphql.ts，网页解析见 web.ts。
 */
export { dmm } from './site'
export {
  type DmmApiCredentials,
  createDmmApi,
  credentialsFromEnv,
  dmmApi,
} from './affiliate'
