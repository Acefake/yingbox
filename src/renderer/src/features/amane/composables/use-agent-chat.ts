/**
 * 智能体对话状态：会话列表、当前会话轨迹的轮询、发送 / 审批续跑 / 停止 / 思考强度、
 * 每个会话各自的草稿。
 *
 * 轨迹按 generation 防串台：切换会话、停用页面、卸载时 generation 自增，
 * 之前发出的请求回来后直接丢弃。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  nextTick,
  reactive,
  ref,
} from 'vue'
import { amaneRequest } from '../api/amane'
import {
  type AgentInterrupt,
  type AgentMessage,
  type AgentSession,
  type AgentTrace,
  agentPath,
  agentRunBody,
  foldAgentTrace,
  getTrace,
} from '../api/amane-agent'
import {
  allDecided as decidedAll,
  emptyTrace,
  followsBottom,
  isFirstTurn,
  pollDelay,
} from '../utils/agent'

export interface AgentChatOptions {
  /** 消息列表滚动容器（用来跟随到底部） */
  messageList: Ref<HTMLElement | null>
  /** 回合结束时调用（刷新查询预设） */
  onTurnEnd: () => Promise<void>
}

/** useAgentChat 的返回值：会话列表、当前回合状态与操作 */
export interface AgentChat {
  sessions: Ref<AgentSession[]>
  selected: Ref<number | null>
  draft: Ref<string>
  error: Ref<string>
  busy: Ref<boolean>
  loadingTrace: Ref<boolean>
  /** 待审批的工具调用：interrupt id → 是否放行 */
  decisions: Record<string, boolean>
  folded: ComputedRef<{
    messages: AgentMessage[]
    interrupts: AgentInterrupt[]
  }>
  running: ComputedRef<boolean>
  currentSession: ComputedRef<AgentSession | undefined>
  allDecided: ComputedRef<boolean>
  isDisposed: () => boolean
  act: (action: () => Promise<void>) => Promise<void>
  selectSession: (id: number) => Promise<void>
  createSession: () => Promise<boolean>
  renameSession: (id: number, title: string) => Promise<boolean>
  deleteSession: (session: AgentSession) => Promise<void>
  refresh: () => Promise<void>
  send: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  setThinking: (thinking: string) => Promise<void>
  start: () => Promise<void>
  activate: () => void
  deactivate: () => void
  dispose: () => void
}

export function useAgentChat(options: AgentChatOptions): AgentChat {
  const { messageList } = options
  const sessions = ref<AgentSession[]>([]),
    selected = ref<number | null>(null)
  const trace = ref<AgentTrace>(emptyTrace())
  const draft = ref(''),
    error = ref(''),
    busy = ref(false),
    loadingTrace = ref(false)
  const decisions = reactive<Record<string, boolean>>({})
  const folded = computed(() => foldAgentTrace(trace.value.events)),
    running = computed(() => trace.value.turn_running)
  const currentSession = computed(() =>
    sessions.value.find(item => item.id === selected.value)
  )
  const allDecided = computed(() =>
    decidedAll(folded.value.interrupts, decisions)
  )
  let timer: ReturnType<typeof setTimeout> | undefined,
    generation = 0,
    active = true,
    disposed = false
  const drafts = new Map<number, string>()

  /** 串行执行一个操作：忙时忽略，出错写进横幅 */
  async function act(action: () => Promise<void>): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (e) {
      if (!disposed) error.value = (e as Error).message
    } finally {
      busy.value = false
    }
  }

  async function refreshSessions(): Promise<void> {
    const result = await amaneRequest<{ items: AgentSession[] }>(
      '/agent/sessions'
    )
    if (!disposed) sessions.value = result.items
  }

  async function refreshTrace(): Promise<void> {
    const id = selected.value,
      version = generation
    if (!id || !active || disposed) return
    const result = await getTrace(id)
    if (version !== generation || disposed || !active) return
    const follow = followsBottom(messageList.value)
    const wasRunning = running.value
    trace.value = result
    await nextTick()
    if (follow && messageList.value)
      messageList.value.scrollTop = messageList.value.scrollHeight
    if (wasRunning && !result.turn_running) {
      await refreshSessions()
      await options.onTurnEnd()
    }
  }

  function schedule(): void {
    clearTimeout(timer)
    if (active && !disposed)
      timer = setTimeout(async () => {
        try {
          await refreshTrace()
        } catch (e) {
          if (!disposed) error.value = (e as Error).message
        } finally {
          schedule()
        }
      }, pollDelay(running.value))
  }

  /** 切到另一个会话：前一个的草稿留着，回来还在 */
  async function selectSession(id: number): Promise<void> {
    if (disposed || busy.value || selected.value === id) return
    if (selected.value) drafts.set(selected.value, draft.value)
    generation++
    clearTimeout(timer)
    selected.value = id
    draft.value = drafts.get(id) || ''
    loadingTrace.value = true
    trace.value = emptyTrace()
    error.value = ''
    for (const key of Object.keys(decisions)) delete decisions[key]
    const version = generation
    try {
      await refreshTrace()
    } catch (e) {
      if (generation === version) error.value = (e as Error).message
    } finally {
      if (version === generation) loadingTrace.value = false
      schedule()
    }
  }

  /** 新建会话并切过去；返回 true 表示已切换（调用方据此收起查询预设） */
  async function createSession(): Promise<boolean> {
    let created = false
    await act(async () => {
      const result = await amaneRequest<AgentSession>(
        '/agent/sessions',
        'POST',
        {}
      )
      await refreshSessions()
      if (selected.value) drafts.set(selected.value, draft.value)
      generation++
      selected.value = result.id
      draft.value = ''
      trace.value = emptyTrace()
      created = true
      schedule()
    })
    return created
  }

  /** 重命名；成功返回 true（调用方据此退出编辑状态） */
  async function renameSession(id: number, title: string): Promise<boolean> {
    if (!title.trim()) return false
    let renamed = false
    await act(async () => {
      await amaneRequest(agentPath(id), 'PATCH', { title: title.trim() })
      renamed = true
      await refreshSessions()
    })
    return renamed
  }

  async function deleteSession(session: AgentSession): Promise<void> {
    if (!window.confirm(`删除对话“${session.title}”？此操作无法撤销。`)) return
    await act(async () => {
      await amaneRequest(agentPath(session.id), 'DELETE')
      drafts.delete(session.id)
      if (selected.value === session.id) {
        generation++
        selected.value = null
        trace.value = emptyTrace()
        draft.value = ''
      }
      await refreshSessions()
    })
  }

  async function refresh(): Promise<void> {
    await act(async () => {
      await refreshSessions()
      await refreshTrace()
    })
  }

  /** 发送草稿；还没有会话时先建一个；首条消息发出后后台起标题 */
  async function send(): Promise<void> {
    if (
      !draft.value.trim() ||
      busy.value ||
      loadingTrace.value ||
      running.value ||
      folded.value.interrupts.length
    )
      return
    const prompt = draft.value.trim()
    await act(async () => {
      if (!selected.value) {
        const session = await amaneRequest<AgentSession>(
          '/agent/sessions',
          'POST',
          {}
        )
        selected.value = session.id
        generation++
        await refreshSessions()
      }
      const id = selected.value!,
        first = isFirstTurn(trace.value.events)
      await amaneRequest(
        `${agentPath(id)}/agui`,
        'POST',
        agentRunBody(id, trace.value.events, prompt)
      )
      draft.value = ''
      drafts.delete(id)
      await refreshTrace()
      schedule()
      if (first)
        void amaneRequest(`${agentPath(id)}/title`, 'POST', {
          prompt: prompt.slice(0, 4000),
        })
          .then(refreshSessions)
          .catch(() => {})
    })
  }

  /** 提交全部审批决定并继续回合 */
  async function resume(): Promise<void> {
    if (!selected.value || !allDecided.value) return
    await act(async () => {
      const id = selected.value!
      const responses = Object.fromEntries(
        folded.value.interrupts.map(item => [item.id, decisions[item.id]])
      )
      await amaneRequest(
        `${agentPath(id)}/agui`,
        'POST',
        agentRunBody(id, trace.value.events, undefined, responses)
      )
      await refreshTrace()
      schedule()
    })
  }

  async function stop(): Promise<void> {
    if (selected.value)
      await act(async () => {
        await amaneRequest(`${agentPath(selected.value!)}/agui/cancel`, 'POST')
        await refreshTrace()
      })
  }

  async function setThinking(thinking: string): Promise<void> {
    if (selected.value)
      await act(async () => {
        await amaneRequest(agentPath(selected.value!), 'PATCH', {
          thinking: thinking || null,
        })
        await refreshSessions()
      })
  }

  /** 首次挂载：读会话列表并打开第一个 */
  async function start(): Promise<void> {
    loadingTrace.value = true
    try {
      await refreshSessions()
      if (!disposed && sessions.value[0])
        await selectSession(sessions.value[0].id)
    } catch (e) {
      if (!disposed) error.value = (e as Error).message
    } finally {
      loadingTrace.value = false
      schedule()
    }
  }

  /** keep-alive 重新激活：恢复轮询 */
  function activate(): void {
    active = true
    schedule()
  }

  /** keep-alive 停用：停轮询并丢弃在途请求 */
  function deactivate(): void {
    active = false
    generation++
    loadingTrace.value = false
    clearTimeout(timer)
  }

  function dispose(): void {
    disposed = true
    active = false
    generation++
    clearTimeout(timer)
  }

  return {
    sessions,
    selected,
    draft,
    error,
    busy,
    loadingTrace,
    decisions,
    folded,
    running,
    currentSession,
    allDecided,
    isDisposed: (): boolean => disposed,
    act,
    selectSession,
    createSession,
    renameSession,
    deleteSession,
    refresh,
    send,
    resume,
    stop,
    setThinking,
    start,
    activate,
    deactivate,
    dispose,
  }
}
