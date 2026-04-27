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

// Module-level singleton — shared across all component instances
const _items = ref<GlobalQueueItem[]>([])
const _isProcessing = ref(false)

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

  const addItem = (
    name: string,
    type: 'movie' | 'tv' | 'download',
    options?: { cancellable?: boolean; cancelFn?: () => void }
  ): string => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    _items.value.push({
      id,
      name,
      type,
      status: 'pending',
      cancellable: options?.cancellable,
      cancelFn: options?.cancelFn,
    })
    _isProcessing.value = true
    return id
  }

  const setProcessing = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item) item.status = 'processing'
  }

  const setDone = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item) item.status = 'done'
    _checkIdle()
  }

  const setError = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (item) item.status = 'error'
    _checkIdle()
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
    _checkIdle()
  }

  const removeItem = (id: string): void => {
    const item = _items.value.find(i => i.id === id)
    if (!item) return
    if (item.status === 'processing') return
    _items.value = _items.value.filter(i => i.id !== id)
  }

  const clearCompleted = (): void => {
    _items.value = _items.value.filter(
      i => i.status === 'pending' || i.status === 'processing'
    )
  }

  const clearAll = (): void => {
    _items.value = []
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
