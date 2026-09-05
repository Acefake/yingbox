import { ref, computed } from 'vue'

export interface GlobalQueueItem {
  id: string
  name: string
  dedupKey?: string
  type: 'movie' | 'tv' | 'download'
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
  currentStep?: string
  steps?: { name: string; done: boolean }[]
  cancellable?: boolean
  cancelFn?: () => void
}

interface TaskEntry {
  handler: (queueId: string, signal: AbortSignal) => Promise<void>
  controller: AbortController
}

// Module-level singleton — shared across all component instances
const _items = ref<GlobalQueueItem[]>([])
const _isProcessing = ref(false)
const _taskMap = new Map<string, TaskEntry>()
const MAX_CONCURRENT = 3
const _running = new Map<string, GlobalQueueItem>()

export function useGlobalQueue() {
  const totalCount = computed(() => _items.value.length)
  const doneCount = computed(
    () =>
      _items.value.filter(
        i =>
          i.status === 'done' ||
          i.status === 'error' ||
          i.status === 'cancelled'
      ).length
  )
  const pendingCount = computed(
    () => _items.value.filter(i => i.status === 'pending').length
  )
  const activeCount = computed(
    () =>
      _items.value.filter(
        i => i.status === 'pending' || i.status === 'processing'
      ).length
  )
  const currentItem = computed(
    () => _items.value.find(i => i.status === 'processing') ?? null
  )
  const progress = computed(() =>
    totalCount.value > 0 ? doneCount.value / totalCount.value : 0
  )
  const hasItems = computed(() => totalCount.value > 0)

  /**
   * 添加任务到队列
   * @param handler 可选的任务执行函数。传入后由调度器自动并发执行；不传则需外部手动调 setProcessing + 业务逻辑
   * @param dedupKey 可选的去重键。传入路径信息可避免不同目录下同名文件被误去重
   * @returns { id, isDuplicate } — id 为队列项 ID，isDuplicate 表示是否命中去重
   */
  const addItem = (
    name: string,
    type: 'movie' | 'tv' | 'download',
    handler?: (queueId: string, signal: AbortSignal) => Promise<void>,
    options?: { cancellable?: boolean; cancelFn?: () => void; dedupKey?: string }
  ): { id: string; isDuplicate: boolean } => {
    // 去重：同名同类型（或同 dedupKey）的 pending/processing 任务不重复添加
    const key = options?.dedupKey || name
    const existing = [..._items.value, ..._running.values()].find(
      i => (i.dedupKey || i.name) === key && i.type === type && (i.status === 'pending' || i.status === 'processing' || _running.has(i.id))
    )
    if (existing) return { id: existing.id, isDuplicate: true }

    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    _items.value.push({
      id,
      name,
      dedupKey: options?.dedupKey,
      type,
      status: 'pending',
      cancellable: options?.cancellable,
      cancelFn: options?.cancelFn,
    })
    if (handler) {
      _taskMap.set(id, { handler, controller: new AbortController() })
    }
    _isProcessing.value = true
    // 触发调度
    _schedule()
    return { id, isDuplicate: false }
  }

  const setProcessing = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item?.status === 'pending') item.status = 'processing'
  }

  const setDone = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item && (item.status === 'pending' || item.status === 'processing')) item.status = 'done'
    _taskMap.delete(id)
    _checkIdle()
    _schedule()
  }

  const setError = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item && (item.status === 'pending' || item.status === 'processing')) item.status = 'error'
    _taskMap.delete(id)
    _checkIdle()
    _schedule()
  }

  const setStep = (
    id: string,
    step: string,
    steps?: { name: string; done: boolean }[]
  ): void => {
    const item = _items.value.find(i => i.id === id)
    if (item?.status === 'processing') {
      item.currentStep = step
      if (steps) item.steps = steps
    }
  }

  const cancelItem = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (!item || !['pending', 'processing'].includes(item.status)) return
    _taskMap.get(id)?.controller.abort()
    item.status = 'cancelled'
    try { item.cancelFn?.() } catch (error) { console.warn('取消回调失败:', error) }
    item.currentStep = undefined
    _taskMap.delete(id)
    _checkIdle()
    _schedule()
  }

  const removeItem = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (!item) return
    if (_running.has(id) || item.status === 'processing') return
    if (item.status === 'pending') cancelItem(id)
    _items.value = _items.value.filter(i => i.id !== id)
    _taskMap.delete(id)
  }

  const clearCompleted = (): void => {
    for (const item of _items.value) {
      if (item.status !== 'pending' && item.status !== 'processing') {
        _taskMap.delete(item.id)
      }
    }
    _items.value = _items.value.filter(
      i => i.status === 'pending' || i.status === 'processing'
    )
  }

  const clearAll = (): void => {
    for (const item of [..._items.value]) cancelItem(item.id)
    _items.value = []
    _taskMap.clear()
    _checkIdle()
  }

  return {
    items: _items,
    isProcessing: _isProcessing,
    totalCount,
    doneCount,
    pendingCount,
    activeCount,
    currentItem,
    progress,
    hasItems,
    addItem,
    setProcessing,
    setDone,
    setError,
    setStep,
    cancelItem,
    removeItem,
    clearCompleted,
    clearAll,
  }
}

function _checkIdle(): void {
  _isProcessing.value = _running.size > 0 || _items.value.some(i => i.status === 'pending' || i.status === 'processing')
}

let scheduled = false
function _schedule(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    const manualRunning = _items.value.filter(i => i.status === 'processing' && !_running.has(i.id)).length
    const slots = Math.max(0, MAX_CONCURRENT - _running.size - manualRunning)
    const pending = _items.value.filter(i => i.status === 'pending' && _taskMap.has(i.id)).slice(0, slots)
    for (const item of pending) {
      const entry = _taskMap.get(item.id)
      if (!entry || item.status !== 'pending') continue
      item.status = 'processing'
      _running.set(item.id, item)
      Promise.resolve().then(() => {
        entry.controller.signal.throwIfAborted()
        return entry.handler(item.id, entry.controller.signal)
      }).then(() => {
        if (item.status === 'processing') item.status = 'done'
      }).catch(error => {
        if (item.status === 'processing') {
          item.status = 'error'
          item.currentStep = error instanceof Error ? error.message : String(error)
        }
      }).finally(() => {
        _running.delete(item.id)
        _taskMap.delete(item.id)
        _checkIdle()
        _schedule()
      })
    }
    _checkIdle()
  })
}
