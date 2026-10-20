import { type Ref, ref, watch } from 'vue'

/**
 * 绑定到 localStorage 某个键的字符串设置。
 *
 * 读取时没有值则用 fallback；之后每次变化（以及创建时一次）写回 localStorage，
 * 其他模块（刮削、TMDB 图片地址等）直接读 localStorage 就能拿到最新值。
 */
export function useStoredSetting<T extends string = string>(
  key: string,
  fallback: T
): Ref<T> {
  const value = ref(
    (localStorage.getItem(key) as T | null) || fallback
  ) as Ref<T>
  watch(value, val => localStorage.setItem(key, val), { immediate: true })
  return value
}
