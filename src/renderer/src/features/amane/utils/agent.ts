/**
 * 智能体面板的纯规则：单元格文本、CSV 导出、跟随滚动、轮询间隔、审批是否齐全。
 */
import type { AgentInterrupt, AgentTrace, TraceRow } from '../api/amane-agent'

/** 思考强度选项（空串 = 跟随全局设置） */
export const THINKING_MODES = [
  { value: 'off', label: '关闭' },
  { value: 'minimal', label: '最低' },
  { value: 'low', label: '较低' },
  { value: 'medium', label: '中等' },
  { value: 'high', label: '较高' },
  { value: 'xhigh', label: '最高' },
]

/** 空对话的提示卡 */
export const AGENT_HINTS = [
  '找出片库中评分最高的影片',
  '有哪些影片还没有关联本地文件？',
  '统计我的片库类型和发行年份',
]

/** 查询结果每页行数 */
export const QUERY_PAGE_SIZE = 100

/** 空轨迹（切换 / 新建 / 删除对话时复位用） */
export const emptyTrace = (): AgentTrace => ({
  events: [],
  turn_running: false,
  last_seq: 0,
  meta: {},
})

/** 单元格 / 参数 / 结果的展示文本：字符串原样，其它转成缩进 JSON */
export const cellText = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '')

/** 一个 CSV 单元格：双引号转义，并防止被表格软件当成公式（=+@- 开头加 '） */
export const csvCell = (value: unknown): string =>
  `"${cellText(value)
    .replace(/"/g, '""')
    .replace(/^[=+@-]/, "'$&")}"`

/** 查询结果 → CSV 文本（表头 + 行，CRLF 分隔，带 BOM 方便 Excel 识别 UTF-8） */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const body = [columns, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n')
  return `\ufeff${body}`
}

/** 导出文件名：amane-query-<预设>-page-<页码>.csv */
export const csvFilename = (queryId: number, offset: number): string =>
  `amane-query-${queryId}-page-${offset / QUERY_PAGE_SIZE + 1}.csv`

/** 用户离底部不到 100px（或还没有列表）时，新消息到来自动滚到底 */
export function followsBottom(
  element: {
    scrollHeight: number
    scrollTop: number
    clientHeight: number
  } | null
): boolean {
  return (
    !element ||
    element.scrollHeight - element.scrollTop - element.clientHeight < 100
  )
}

/** 回合进行中每秒刷新，空闲时 6 秒 */
export const pollDelay = (running: boolean): number => (running ? 1000 : 6000)

/** 每个待审批操作都已做出决定 */
export const allDecided = (
  interrupts: AgentInterrupt[],
  decisions: Record<string, boolean>
): boolean => interrupts.every(item => Object.hasOwn(decisions, item.id))

/** 对话里还没有用户消息（首条消息发送后要自动起标题） */
export const isFirstTurn = (events: TraceRow[]): boolean =>
  !events.some(row => row.type === 'user_message')
