import type { BrandColor } from '../../../../shared/brand'

/** 配色显示名和资源路径，共享给品牌组件及外观设置。 */
export const BRAND_OPTIONS = [
  { value: 'purple', label: '紫水晶' },
  { value: 'blue', label: '冰川蓝' },
  { value: 'green', label: '翡翠绿' },
  { value: 'gold', label: '琥珀金' },
  { value: 'white', label: '珍珠白' },
  { value: 'graphite', label: '烟灰' },
] as const

const icons = import.meta.glob<string>('../../assets/imgs/brand/icon-*.png', {
  eager: true,
  import: 'default',
})
const words = import.meta.glob<string>(
  '../../assets/imgs/brand/wordmark-*.png',
  { eager: true, import: 'default' }
)

/** 返回图标 URL；资源必须由品牌导出脚本生成。 */
export function brandIcon(color: BrandColor): string {
  return icons[`../../assets/imgs/brand/icon-${color}.png`]
}

/** 返回中文字标 URL。 */
export function brandWordmark(color: BrandColor): string {
  return words[`../../assets/imgs/brand/wordmark-${color}.png`]
}
