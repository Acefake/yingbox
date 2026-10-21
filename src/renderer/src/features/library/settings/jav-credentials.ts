/**
 * 番号站点凭据的展示规则：哪些站点要凭据、怎么填、在哪里拿。纯数据 + 纯函数，便于测试。
 */
import type {
  JavCredentialProvider,
  ProviderStatus,
} from '../../../../../shared/library/ipc'

/** 一项凭据。 */
export interface JavCredentialField {
  provider: JavCredentialProvider
  title: string
  /** 说明（填什么、不填会怎样）。 */
  description: string
  placeholder: string
}

/** 需要凭据的番号站点，按设置页显示顺序。 */
export const JAV_CREDENTIAL_FIELDS: readonly JavCredentialField[] = [
  {
    provider: 'theporndb',
    title: 'ThePornDB 令牌',
    description: '填了才查 ThePornDB（在 ThePornDB 账户设置里创建 API Token）',
    placeholder: '粘贴 API Token',
  },
  {
    provider: 'javdb',
    title: 'JavDB Cookie',
    description: '可选；登录后的 Cookie，填了才查 FC2',
    placeholder: '_jdb_session=…',
  },
  {
    provider: 'dmm_api',
    title: 'DMM 官方 API',
    description: '可选；格式「API ID:联盟 ID」，联盟 ID 以 990–999 结尾',
    placeholder: 'API_ID:xxxx-990',
  },
]

/** 状态文案。 */
export function credentialStatus(
  status: ProviderStatus | undefined,
  provider: JavCredentialProvider
): string {
  if (!status) return '读取中'
  return status[provider].configured ? '已配置' : '未配置'
}
