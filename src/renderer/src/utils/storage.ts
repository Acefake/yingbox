export function readStoredArray<T>(key: string, valid: (value: unknown) => boolean = value => !!value && typeof value === 'object'): T[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(data) ? data.filter(valid) as T[] : []
  } catch { return [] }
}

export function saveStoredArray(key: string, values: unknown[]): boolean {
  try { localStorage.setItem(key, JSON.stringify(values)); return true }
  catch (error) { console.warn(`无法保存 ${key}:`, error); return false }
}
