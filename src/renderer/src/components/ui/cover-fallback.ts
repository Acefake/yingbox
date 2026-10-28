/**
 * 封面加载失败时的色块：同一片名始终同一渐变，不同片名色相错开。
 * 颜色写在绑定的 style 上（片名决定色相，不能做成静态令牌）。
 */
export function coverGradient(title: string): string {
  let hash = 0
  const text = title.trim() || '影'
  for (let i = 0; i < text.length; i++)
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) >>> 0
  const hue = hash % 360
  const next = (hue + 32) % 360
  return `linear-gradient(160deg, hsl(${hue} 34% 34%), hsl(${next} 28% 16%))`
}
