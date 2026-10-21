/**
 * 站点检索结果的番号核对：在 codeKey（忽略分隔符、大小写、前导零）之上，
 * 兼容日期型无码番号前面拼了厂牌名的写法（caribbeancom010120-001、1pondo_010120_001）。
 * 纯函数，供 freejavbt / airav / iqqtv 等「搜索后逐条核对」的站点共用。
 */
import { codeKey } from '../number'

/** 日期型无码番号：010120-001、010120_01。 */
const DATED = /^\d{6}[-_]\d{2,3}$/

/**
 * 站点上写的番号 found 是否就是要找的 code。
 * 日期型番号允许 found 多出以字母结尾的厂牌前缀；其他番号必须 codeKey 完全相等，
 * 免得 XSSIS-497 一类前缀不同的番号被误认成 SSIS-497。
 */
export function sameCode(found: string, code: string): boolean {
  const a = codeKey(found)
  const b = codeKey(code)
  if (!a || !b) return false
  if (a === b) return true
  return (
    DATED.test(code) && a.endsWith(b) && /[a-z]$/.test(a.slice(0, -b.length))
  )
}

/** 站上的番号写法 → 常规写法：去掉日期型番号前面拼的厂牌名（caribbeancom010120-001 → 010120-001）。 */
export function plainCode(raw: string): string {
  const dated = /^[a-z0-9]*?[a-z]_?(\d{6}[-_]\d{2,3})$/i.exec(raw)
  return dated ? dated[1] : raw
}
