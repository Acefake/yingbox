/**
 * 「新入库」设置分区的纯规则：Bark 地址校验、密钥输入框的占位文字、每日上限的选项。
 */
import type { SelectOption } from '@/components/ui/UiSelect.vue'

/** Bark 服务器地址是否像样（http / https）。 */
export function validBarkServer(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** 密钥输入框的占位：已配置时说明不回显。 */
export function secretPlaceholder(configured: boolean, label: string): string {
  return configured ? '已配置（加密保存，不回显）；输入新的可替换' : label
}

/** 每日上限的选项（当前值不在预设里时也列出来）。 */
export function dailyLimitOptions(current: number): SelectOption[] {
  const values = [...new Set([3, 5, 10, 20, 50, current])].sort((a, b) => a - b)
  return values.map(value => ({ value, label: `${value} 份` }))
}
