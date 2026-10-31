import type { ResourceKind, SearchResource, SourceState } from './types'

export type ProviderKind = 'local' | 'online' | 'netdisk' | 'ai'
/** 一次会话拥有发布权；取消后 IPC 即使晚到也不能改变结果。 */
export class SearchSession {
  private controller = new AbortController()
  private requests = new Map<string, Promise<void>>()
  private resources = new Map<string, SearchResource>()
  readonly states: Record<ProviderKind, SourceState> = {
    local: { status: 'idle', count: 0, message: '' },
    online: { status: 'idle', count: 0, message: '' },
    netdisk: { status: 'idle', count: 0, message: '' },
    ai: { status: 'idle', count: 0, message: '' },
  }
  constructor(
    private changed: (
      items: SearchResource[],
      states: SearchSession['states']
    ) => void
  ) {}
  get signal(): AbortSignal {
    return this.controller.signal
  }
  cancel(): void {
    this.controller.abort()
  }
  publish(items: SearchResource[]): void {
    if (this.signal.aborted) return
    for (const item of items) {
      const old = this.resources.get(item.key)
      this.resources.set(
        item.key,
        old
          ? {
              ...old,
              ...item,
              interpreted: old.interpreted || item.interpreted,
              reason: old.reason.startsWith('AI 理解')
                ? old.reason
                : item.reason,
              sources: [...new Set([...old.sources, ...item.sources])],
            }
          : item
      )
    }
    this.emit()
  }
  status(kind: ProviderKind, state: Partial<SourceState>): void {
    if (this.signal.aborted) return
    Object.assign(this.states[kind], state)
    this.emit()
  }
  private emit(): void {
    if (this.signal.aborted) return
    const items = [...this.resources.values()]
    const counts: Record<ProviderKind, ResourceKind[]> = {
      local: ['local'],
      online: ['online'],
      netdisk: ['share', 'magnet'],
      ai: [],
    }
    for (const kind of ['local', 'online', 'netdisk'] as const)
      this.states[kind].count = items.filter(item =>
        counts[kind].includes(item.kind)
      ).length
    this.changed(items, structuredClone(this.states))
  }
  async run(
    kind: ProviderKind,
    keyword: string,
    job: () => Promise<string | void>,
    retry = false
  ): Promise<void> {
    const key = `${kind}:${keyword}`
    if (this.signal.aborted) return
    if (!retry && this.requests.has(key)) return this.requests.get(key)
    const request = (async () => {
      this.status(kind, { status: 'loading', message: '' })
      try {
        const message = await job()
        this.status(kind, {
          status:
            this.states[kind].status === 'unconfigured'
              ? 'unconfigured'
              : 'done',
          message: message || '',
        })
      } catch (error) {
        this.status(kind, {
          status: 'error',
          message: error instanceof Error ? error.message : '搜索失败，请重试',
        })
      }
    })()
    this.requests.set(key, request)
    return request
  }
}
