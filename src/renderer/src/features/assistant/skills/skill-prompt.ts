/**
 * 由生效技能拼提示词与 JSON Schema、严格校验模型输出、按状态路由（纯函数，不依赖 Vue / IPC）。
 *
 * 模型只负责把一句话归到某个已登记的动作上，输出一律当不可信数据：动作名不在当前生效技能里、
 * 参数缺失 / 越界的一律降级成「只回答文字」，不会执行任何动作。
 */
import type { AiMessage } from '@/features/ai'

import type {
  AssistantContext,
  AssistantSkill,
  SkillAction,
  SkillRaw,
} from './skill-types'

/** 用户一句话最多取多少字 */
export const ASK_CHARS = 200
/** 只回答文字的动作名 */
export const ANSWER_ACTION = 'answer'
/** 建议胶囊最多几条 */
const SUGGESTION_LIMIT = 4

/** 截到最多 n 个字并去掉首尾空白 */
export function clipText(text: string, n = ASK_CHARS): string {
  return [...text.trim()].slice(0, n).join('').trim()
}

/** 已校验、可以执行的意图 */
export type AssistantIntent =
  | { kind: 'action'; id: string; action: SkillAction; params: unknown }
  | { kind: 'answer' }

/** 解析结果：意图 + 要对用户说的话 */
export interface ParsedIntent {
  intent: AssistantIntent
  reply: string
}

/** 生效技能的全部动作：完整动作名 → 动作 */
export function actionTable(
  skills: readonly AssistantSkill[]
): Map<string, SkillAction> {
  const table = new Map<string, SkillAction>()
  for (const skill of skills)
    for (const action of skill.actions)
      table.set(`${skill.id}.${action.name}`, action)
  return table
}

/** 要求模型输出的结构（字段全部必填，用不到的给空串 / null） */
export function intentSchema(
  skills: readonly AssistantSkill[]
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...actionTable(skills).keys(), ANSWER_ACTION],
      },
      reply: { type: 'string' },
      text: { type: 'string' },
      target: { type: 'string' },
      command: { type: 'string' },
      value: { type: ['number', 'null'] },
      on: { type: ['boolean', 'null'] },
    },
    required: ['action', 'reply', 'text', 'target', 'command', 'value', 'on'],
    additionalProperties: false,
  }
}

/** 时间点写成 h:mm:ss / m:ss */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/**
 * 当前状态的说明（页面、在播片名与时间点），让「这部」「刚才那段」能被理解。
 * 片名与时间点在普通与私密模式都给：私密模式的模型请求一律带 localOnly（assistant-deps.ts 的 privacyFields），
 * 主进程拒绝非本地服务商，片名不会发到云端。
 */
export function contextLines(context: AssistantContext): string[] {
  const lines = [`用户当前在「${context.route.title}」页面。`]
  const now = context.nowPlaying
  if (now)
    lines.push(
      `正在播放《${now.title}》，播到 ${clockText(now.seconds)}；用户说「这部」「刚才那段」指的就是它和这个时间点之前不久。`
    )
  else
    lines.push(context.playing ? '当前正在播放视频。' : '当前没有在播放视频。')
  return lines
}

/** 发给 chatJson 的消息：系统提示由生效技能拼出，history 是这次会话前几轮（只在内存里） */
export function buildIntentMessages(
  text: string,
  context: AssistantContext,
  skills: readonly AssistantSkill[],
  history: readonly AiMessage[] = []
): AiMessage[] {
  const lines = [
    '你是影视应用「影盒」里的语音助手，把用户的一句话归成一个动作，只输出 JSON。',
    '动作 action（只能从下面选）：',
  ]
  for (const skill of skills)
    for (const action of skill.actions)
      lines.push(`- ${skill.id}.${action.name}：${action.describe}`)
  lines.push(`- ${ANSWER_ACTION}：闲聊或其他问题，reply 留空串。`)
  for (const skill of skills) lines.push(...(skill.prompt?.(context) ?? []))
  lines.push(
    'reply 是执行动作时对用户说的一句中文短话（不超过 30 字）。用不到的字段：字符串给空串，value / on 给 null。',
    ...contextLines(context)
  )
  return [
    { role: 'system', content: lines.join('\n') },
    ...history,
    { role: 'user', content: clipText(text) },
  ]
}

/** 「只回答文字」时发给 chatStream 的消息 */
export function buildAnswerMessages(
  text: string,
  context: AssistantContext,
  history: readonly AiMessage[] = []
): AiMessage[] {
  const system = [
    '你是影视应用「影盒」里的助手，用简体中文简短回答（不超过 120 字），语气自然。',
    '谈到具体影视作品的剧情时不要剧透结局和关键反转。',
    ...contextLines(context),
  ].join('\n')
  return [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: clipText(text) },
  ]
}

/** chatJson 的粗结构校验：是对象就交给 parseIntent 细查 */
export function isIntentShape(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === 'object' && !Array.isArray(data)
}

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** 原始输出 → 通用参数槽（类型不对的当没给） */
export function rawSlots(raw: Record<string, unknown>): SkillRaw {
  return {
    text: clipText(str(raw.text)),
    target: str(raw.target),
    command: str(raw.command),
    value:
      typeof raw.value === 'number' && Number.isFinite(raw.value)
        ? raw.value
        : null,
    on: typeof raw.on === 'boolean' ? raw.on : null,
  }
}

/**
 * 严格校验模型输出：动作名不在生效技能里、参数校验不过的，一律降级成 answer（只回答文字）。
 */
export function parseIntent(
  raw: unknown,
  skills: readonly AssistantSkill[]
): ParsedIntent {
  const answer: ParsedIntent = { intent: { kind: 'answer' }, reply: '' }
  if (!isIntentShape(raw)) return answer
  const id = str(raw.action)
  const action = actionTable(skills).get(id)
  if (!action) return answer
  const params = action.parse(rawSlots(raw))
  if (params === null || params === undefined) return answer
  return {
    intent: { kind: 'action', id, action, params },
    reply: clipText(str(raw.reply), 60),
  }
}

/** 路由结果：可以执行，或给用户一句说明 */
export type IntentRoute =
  | { kind: 'run'; intent: AssistantIntent }
  | { kind: 'explain'; text: string }

/** 按当前状态决定能不能执行（由动作自己的 gate 判定） */
export function routeIntent(
  intent: AssistantIntent,
  context: AssistantContext
): IntentRoute {
  if (intent.kind === 'answer') return { kind: 'run', intent }
  const gate = intent.action.gate?.(intent.params, context) ?? null
  if (!gate) return { kind: 'run', intent }
  return gate.kind === 'explain'
    ? { kind: 'explain', text: gate.text }
    : { kind: 'run', intent: { kind: 'answer' } }
}

/** 建议胶囊：私密技能在前，其余按登记顺序合并、去重，取前几条 */
export function skillSuggestions(
  skills: readonly AssistantSkill[],
  context: AssistantContext
): string[] {
  const ordered = [
    ...skills.filter(skill => skill.scope === 'private'),
    ...skills.filter(skill => skill.scope !== 'private'),
  ]
  const all = ordered.flatMap(skill => skill.suggestions?.(context) ?? [])
  return [...new Set(all)].slice(0, SUGGESTION_LIMIT)
}

/** 输入框占位文字：生效技能给了就用它的 */
export function skillPlaceholder(
  skills: readonly AssistantSkill[],
  fallback: string
): string {
  return skills.find(skill => skill.placeholder)?.placeholder ?? fallback
}
