/**
 * AI 助手的意图规则（纯函数）：给模型的提示与 JSON Schema、模型输出的严格校验、按当前状态路由。
 *
 * 模型只负责把一句话归到固定的几种动作上，输出一律当不可信数据：动作不在清单里、参数缺失 / 越界 /
 * 指向私密页面的，一律降级成「只回答文字」，不会执行任何动作。不依赖 Vue / IPC，便于测试。
 */
import type { AiMessage } from '@/features/ai'
import type { PlayerRemoteCommand, SleepChoice } from '@/features/player'

/** 用户一句话最多取多少字（再长的截掉，不整段发给模型） */
export const ASK_CHARS = 200

/** 可以跳转的页面（成人页面不在其中） */
export const ASSISTANT_PAGES = {
  online: { path: '/', label: '在线' },
  movie: { path: '/movie', label: '电影' },
  tv: { path: '/tv', label: '剧集' },
  calendar: { path: '/calendar', label: '追剧日历' },
  live: { path: '/live', label: '直播' },
} as const

/** 页面 id */
export type AssistantPage = keyof typeof ASSISTANT_PAGES

/** 可以打开的设置分区（成人相关分区不在其中） */
export const ASSISTANT_SETTINGS = {
  appearance: '外观',
  images: '图片质量',
  scrape: '刮削',
  provider: '服务',
  sources: '数据源',
  player: '播放器',
  danmaku: '弹幕',
  ai: 'AI',
  assistant: 'AI 助手',
  update: '软件更新',
} as const

/** 设置分区 id */
export type AssistantSettingsSection = keyof typeof ASSISTANT_SETTINGS

/** 校验过、可以执行的意图 */
export type AssistantIntent =
  /** 推荐今晚看什么；note 是用户的要求原话 */
  | { kind: 'recommend'; note: string }
  /** 继续播放上次没看完的 */
  | { kind: 'continue' }
  /** 在媒体库里按描述搜索 / 筛选 */
  | { kind: 'search'; section: 'movie' | 'tv'; query: string }
  /** 控制正在播放的视频 */
  | { kind: 'player'; command: PlayerRemoteCommand }
  | { kind: 'navigate'; page: AssistantPage }
  | { kind: 'settings'; section: AssistantSettingsSection }
  /** 问正在看的剧情（转给问剧情，不剧透） */
  | { kind: 'plot'; question: string }
  /** 其余：只回答文字 */
  | { kind: 'answer' }

/** 意图的种类 */
export type AssistantIntentKind = AssistantIntent['kind']

/** 模型能选的动作 */
const ACTIONS: readonly AssistantIntentKind[] = [
  'recommend',
  'continue',
  'search',
  'player',
  'navigate',
  'settings',
  'plot',
  'answer',
]

/** 播放器命令名 */
const PLAYER_COMMANDS = [
  'danmaku',
  'danmakuOpacity',
  'subtitle',
  'sleep',
  'skipIntro',
  'rate',
] as const

/** 路由时需要知道的当前状态 */
export interface AssistantContext {
  /** 有播放弹窗（含小窗） */
  playing: boolean
  /** 内置播放器实例可控制（外置 mpv 时为 false） */
  controllable: boolean
  /** 当前视频支持问剧情 */
  plotQa: boolean
  /** 当前在私密板块或在播私密内容：模型请求带 private */
  private: boolean
}

/** 要求模型输出的结构（字段全部必填，用不到的给空串 / null） */
export const INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ACTIONS] },
    reply: { type: 'string' },
    text: { type: 'string' },
    target: { type: 'string' },
    command: { type: 'string', enum: [...PLAYER_COMMANDS, ''] },
    value: { type: ['number', 'null'] },
    on: { type: ['boolean', 'null'] },
  },
  required: ['action', 'reply', 'text', 'target', 'command', 'value', 'on'],
  additionalProperties: false,
}

/** 截到最多 n 个字并去掉首尾空白 */
export function clipText(text: string, n = ASK_CHARS): string {
  return [...text.trim()].slice(0, n).join('').trim()
}

/** 发给 chatJson 的消息 */
export function buildIntentMessages(
  text: string,
  context: AssistantContext
): AiMessage[] {
  const pages = Object.entries(ASSISTANT_PAGES)
    .map(([id, page]) => `${id}=${page.label}`)
    .join('、')
  const sections = Object.entries(ASSISTANT_SETTINGS)
    .map(([id, label]) => `${id}=${label}`)
    .join('、')
  const system = [
    '你是影视应用「影盒」里的语音助手，把用户的一句话归成一个动作，只输出 JSON。',
    '动作 action：',
    '- recommend：想让你推荐今晚看什么；text 写用户的要求原话（心情、类型、时长）。',
    '- continue：想接着看上次没看完的。',
    '- search：在本地媒体库里找片；target 为 movie 或 tv，text 写筛选描述（如「90 年代的高分港片」）。',
    '- player：控制正在播放的视频；command 取 danmaku（开关弹幕，on）、danmakuOpacity（弹幕不透明度，value 取 0.1–1）、subtitle（开关字幕，on）、sleep（睡眠定时，target 取 off / episode / 30 / 60 / 90）、skipIntro（跳过片头）、rate（倍速，value 取 0.25–4）。',
    `- navigate：打开页面；target 取 ${pages}。`,
    `- settings：打开设置；target 取 ${sections}。`,
    '- plot：问正在看的剧情（人物、前面发生了什么）；text 写问题。',
    '- answer：闲聊或其他问题，reply 留空串。',
    'reply 是执行动作时对用户说的一句中文短话（不超过 30 字）。用不到的字段：字符串给空串，value / on 给 null。',
    context.playing ? '当前正在播放视频。' : '当前没有在播放视频。',
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: clipText(text) },
  ]
}

/** 「只回答文字」时发给 chatStream 的消息 */
export function buildAnswerMessages(
  text: string,
  context: AssistantContext
): AiMessage[] {
  const system = [
    '你是影视应用「影盒」里的助手，用简体中文简短回答（不超过 120 字），语气自然。',
    '谈到具体影视作品的剧情时不要剧透结局和关键反转。',
    context.playing ? '用户正在看视频。' : '',
  ]
    .filter(Boolean)
    .join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: clipText(text) },
  ]
}

/** chatJson 的粗结构校验：是对象就交给 parseIntent 细查 */
export function isIntentShape(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === 'object' && !Array.isArray(data)
}

/** 解析结果：意图 + 要对用户说的话 */
export interface ParsedIntent {
  intent: AssistantIntent
  reply: string
}

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const isKey = <T extends object>(
  table: T,
  key: string
): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(table, key)

/** 睡眠定时的写法 → 选项；认不出返回 null */
function sleepChoice(target: string, value: number | null): SleepChoice | null {
  if (target === 'off' || target === 'episode') return target
  const minutes = Number(target) || value
  return minutes === 30 || minutes === 60 || minutes === 90 ? minutes : null
}

/** 播放器命令的参数校验；不合格返回 null */
function playerCommand(
  raw: Record<string, unknown>
): PlayerRemoteCommand | null {
  const command = str(raw.command)
  const on = typeof raw.on === 'boolean' ? raw.on : null
  const value = finite(raw.value)
  switch (command) {
    case 'danmaku':
    case 'subtitle':
      return on === null ? null : { kind: command, on }
    case 'danmakuOpacity': {
      // 模型偶尔给百分数（50 表示 50%）
      const ratio =
        value !== null && value > 1 && value <= 100 ? value / 100 : value
      return ratio !== null && ratio >= 0.1 && ratio <= 1
        ? { kind: 'danmakuOpacity', value: ratio }
        : null
    }
    case 'sleep': {
      const choice = sleepChoice(str(raw.target), value)
      return choice === null ? null : { kind: 'sleep', choice }
    }
    case 'skipIntro':
      return { kind: 'skipIntro' }
    case 'rate':
      return value !== null && value >= 0.25 && value <= 4
        ? { kind: 'rate', value }
        : null
    default:
      return null
  }
}

/** 动作 + 参数 → 意图；任何一项不合格返回 null */
function intentOf(
  action: string,
  raw: Record<string, unknown>
): AssistantIntent | null {
  const text = clipText(str(raw.text))
  const target = str(raw.target)
  switch (action) {
    case 'recommend':
      return { kind: 'recommend', note: text }
    case 'continue':
      return { kind: 'continue' }
    case 'search':
      return text && (target === 'movie' || target === 'tv')
        ? { kind: 'search', section: target, query: text }
        : null
    case 'player': {
      const command = playerCommand(raw)
      return command ? { kind: 'player', command } : null
    }
    case 'navigate':
      return isKey(ASSISTANT_PAGES, target)
        ? { kind: 'navigate', page: target }
        : null
    case 'settings':
      return isKey(ASSISTANT_SETTINGS, target)
        ? { kind: 'settings', section: target }
        : null
    case 'plot':
      return text ? { kind: 'plot', question: text } : null
    case 'answer':
      return { kind: 'answer' }
    default:
      return null
  }
}

/**
 * 严格校验模型输出。未知动作、参数不合格、指向清单外页面的一律降级成 answer（只回答文字）。
 */
export function parseIntent(raw: unknown): ParsedIntent {
  if (!isIntentShape(raw)) return { intent: { kind: 'answer' }, reply: '' }
  const intent = intentOf(str(raw.action), raw) ?? { kind: 'answer' }
  const reply = intent.kind === 'answer' ? '' : clipText(str(raw.reply), 60)
  return { intent, reply }
}

/** 路由结果：可以执行，或给用户一句说明 */
export type IntentRoute =
  | { kind: 'run'; intent: AssistantIntent }
  | { kind: 'explain'; text: string }

/**
 * 按当前状态决定能不能执行：播放器命令只在内置播放器播放中可用；
 * 剧情问题在播放中转给问剧情，不在播放时当普通问题回答。
 */
export function routeIntent(
  intent: AssistantIntent,
  context: AssistantContext
): IntentRoute {
  if (intent.kind === 'player') {
    if (!context.playing)
      return {
        kind: 'explain',
        text: '现在没有正在播放的视频，开始播放后再让我调。',
      }
    if (!context.controllable)
      return { kind: 'explain', text: '外置播放器播放时不能在这里控制。' }
  }
  if (intent.kind === 'plot') {
    if (!context.playing) return { kind: 'run', intent: { kind: 'answer' } }
    if (!context.plotQa)
      return {
        kind: 'explain',
        text: '这个视频暂时不能问剧情：需要本地视频，并且之前的集生成过 AI 字幕。',
      }
  }
  return { kind: 'run', intent }
}

/** 输入框下方的建议（播放中给播放器相关的） */
export function assistantSuggestions(playing: boolean): string[] {
  return playing
    ? ['关掉弹幕', '1.5 倍速', '30 分钟后停止播放', '刚才发生了什么']
    : ['今晚看什么', '继续上次看的', '找 90 年代的高分港片', '打开 AI 设置']
}
