/** 设备品牌配色，所有客户端使用相同键名，首次启动为紫色。 */
export const BRAND_COLORS = [
  'purple',
  'blue',
  'green',
  'gold',
  'white',
  'graphite',
] as const

/** 品牌配色键。 */
export type BrandColor = (typeof BRAND_COLORS)[number]
