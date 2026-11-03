/**
 * 应用更新 view.appUpdate（ADR-0037）：有比当前版本新的安卓发布时给出该设备能用的那个包。
 */
import { type Infer, s } from './schema'

export const ViewAppUpdateSchema = s.object('ViewAppUpdate', {
  version: s.string,
  /** 发布说明；没有为空串 */
  notes: s.string,
  /** 下载地址（https） */
  url: s.string,
  /** 包大小（字节），必须为正整数 */
  size: s.number,
  /** 包的 SHA-256（64 位十六进制） */
  sha256: s.string,
  publishedAt: s.string,
})

export type ViewAppUpdate = Infer<typeof ViewAppUpdateSchema>
