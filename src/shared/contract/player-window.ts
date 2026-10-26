import {
  type PlayerWindowPayload,
  type PlayerWindowProgress,
  type PlayerWindowReply,
  type PlayerWindowRequest,
  type PlayerWindowState,
  parsePlayerWindowReply,
  parsePlayerWindowRequest,
  parsePlayerWindowState,
} from '../player-window'
import {
  ContractError,
  call,
  defineDomain,
  event,
  int,
  record,
  str,
} from './define'

/**
 * 独立播放器窗口（src/main/player-window）。
 * open / command 只接受主窗口调用，ready / progress / state / reply / navigate 只接受播放器窗口调用；close 两边都能调。
 */
export const playerWindow = defineDomain(
  'playerWindow',
  {
    /** 主窗口：在播放器窗口里播放（没开就打开，开着就换片并聚焦） */
    open: call<[payload: PlayerWindowPayload], void>(a => [
      record<PlayerWindowPayload>(a[0], 'payload'),
    ]),
    /** 关掉播放器窗口（停止播放） */
    close: call<void>(),
    /** 主窗口：遥控播放器窗口（AI 助手）；没在播时直接回执失败 */
    command: call<[request: PlayerWindowRequest], PlayerWindowReply>(a => {
      const request = parsePlayerWindowRequest(a[0])
      if (!request) throw new ContractError('参数 request 不是合法的请求')
      return [request]
    }),
    /** 播放器窗口：页面就绪，取走等着的载荷（之后的换片走 play 事件） */
    ready: call<PlayerWindowPayload | null>(),
    /** 播放器窗口：一条进度事件，转给主窗口写 */
    progress: call<[event: PlayerWindowProgress], void>(a => [
      record<PlayerWindowProgress>(a[0], 'event'),
    ]),
    /** 播放器窗口：在播状态变了（null = 没在播） */
    state: call<[state: PlayerWindowState | null], void>(a => {
      const state = parsePlayerWindowState(a[0])
      if (state === undefined)
        throw new ContractError('参数 state 不是合法的在播状态')
      return [state]
    }),
    /** 播放器窗口：在主窗口打开应用内地址（如播完提示的「去追更」），并把主窗口带到前面 */
    navigate: call<[to: string], void>(a => {
      const to = str(a[0], 'to')
      if (!to.startsWith('/')) throw new ContractError('参数 to 应为应用内地址')
      return [to]
    }),
    /** 播放器窗口：请求的回执 */
    reply: call<[id: number, reply: PlayerWindowReply], void>(a => {
      const reply = parsePlayerWindowReply(a[1])
      if (!reply) throw new ContractError('参数 reply 不是合法的回执')
      return [int(a[0], 'id'), reply]
    }),
  },
  {
    /** → 播放器窗口：换片 */
    play: event<PlayerWindowPayload>(),
    /** → 播放器窗口：主窗口的请求，回执经 reply 带回 */
    remote: event<{ id: number; request: PlayerWindowRequest }>(),
    /** → 主窗口：播放器窗口的进度事件 */
    relay: event<PlayerWindowProgress>(),
    /** → 主窗口：在播状态（播放器窗口关掉时为 null） */
    session: event<PlayerWindowState | null>(),
    /** → 主窗口：打开应用内地址 */
    route: event<string>(),
  }
)
