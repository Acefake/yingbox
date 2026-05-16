import { ref, computed } from 'vue'

export interface GlobalQueueItem {
  id: string
  name: string
  type: 'movie' | 'tv' | 'download'
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
  currentStep?: string
  steps?: { name: string; done: boolean }[]
  cancellable?: boolean
  cancelFn?: () => void
}

interface TaskEntry {
  handler: (queueId: string) => Promise<void>
}

// Module-level singleton — shared across all component instances
const _items = ref<GlobalQueueItem[]>([])
const _isProcessing = ref(false)
const _taskMap = new Map<string, TaskEntry>()
const MAX_CONCURRENT = 3

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
   * @returns { id, isDuplicate } — id 为队列项 ID，isDuplicate 表示是否命中去重
   */
  const addItem = (
    name: string,
    type: 'movie' | 'tv' | 'download',
    handler?: (queueId: string) => Promise<void>,
    options?: { cancellable?: boolean; cancelFn?: () => void }
  ): { id: string; isDuplicate: boolean } => {
    // 去重：同名同类型的 pending/processing 任务不重复添加
    const existing = _items.value.find(
      i => i.name === name && i.type === type && (i.status === 'pending' || i.status === 'processing')
    )
    if (existing) return { id: existing.id, isDuplicate: true }

    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    _items.value.push({
      id,
      name,
      type,
      status: 'pending',
      cancellable: options?.cancellable,
      cancelFn: options?.cancelFn,
    })
    if (handler) {
      _taskMap.set(id, { handler })
    }
    _isProcessing.value = true
    // 触发调度
    _schedule()
    return { id, isDuplicate: false }
  }

  const setProcessing = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item) item.status = 'processing'
  }

  const setDone = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item) item.status = 'done'
    _taskMap.delete(id)
    _checkIdle()
    _schedule()
  }

  const setError = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item) item.status = 'error'
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
    if (item) {
      item.currentStep = step
      if (steps) item.steps = steps
    }
  }

  const cancelItem = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (!item) return
    if (item.cancelFn) item.cancelFn()
    item.status = 'cancelled'
    item.currentStep = undefined
    _taskMap.delete(id)
    _checkIdle()
    _schedule()
  }

  const removeItem = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (!item) return
    if (item.status === 'processing') return
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
    _items.value = []
    _taskMap.clear()
    _isProcessing.value = false
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
  if (
    _items.value.every(
      i =>
        i.status === 'done' || i.status === 'error' || i.status === 'cancelled'
    )
  ) {
    _isProcessing.value = false
  }
}

/**
 * 调度器：检查是否有空闲槽位，取出有 handler 的 pending 任务并执行
 * 没有 handler 的任务（旧式 addItem）由外部代码手动管理，调度器不管
 */
function _schedule(): void {
  const running = _items.value.filter(i => i.status === 'processing').length
  const slots = MAX_CONCURRENT - running
  if (slots <= 0) return

  // 只调度有 handler 的 pending 任务
  const pending = _items.value.filter(i => i.status === 'pending' && _taskMap.has(i.id))
  const toStart = pending.slice(0, slots)

  for (const item of toStart) {
    const entry = _taskMap.get(item.id)!
    item.status = 'processing'
    entry.handler(item.id).catch(() => {
      const it = _items.value.find(i => i.id === item.id)
      if (it && it.status === 'processing') it.status = 'error'
      _taskMap.delete(item.id)
      _checkIdle()
      _schedule()
    })
  }
}
