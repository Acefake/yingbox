/**
 * AI 助手技能包的类型：助手核心只认识这些形状，具体功能（媒体库、播放器、页面跳转……）各自是一个技能包。
 *
 * 一个技能包声明 id、生效范围（普通 / 私密 / 都可）、若干动作（提示词描述 + 参数校验 + 门槛 + 执行器）、
 * 提示词片段与建议胶囊。模型输出共用一套参数槽（{@link SkillRaw}），每个动作自己校验要用的槽，
 * 不合格就返回 null，由核心降级为只回答文字。
 */
import type { Component } from 'vue'
import type { Router } from 'vue-router'

import type { IconName, SpecBadge } from '@/components/ui'
import type { LibraryCardInfo } from '@/features/library'

/** 当前在播什么（只在内置播放器播放时有） */
export interface NowPlaying {
  title: string
  /** 播到第几秒 */
  seconds: number
}

/** 助手看得到的当前状态 */
export interface AssistantContext {
  /** 当前页面的路径与名称 */
  route: { path: string; title: string }
  /** 有播放会话（桌面端播放器窗口开着，或网页端播放层开着） */
  playing: boolean
  /** 内置播放器实例可控制（外置 mpv 时为 false） */
  controllable: boolean
  /** 当前视频支持问剧情 */
  plotQa: boolean
  /** 当前在私密分区或在播私密内容：模型请求只发给本地模型 */
  private: boolean
  /** 在播的片名与时间点 */
  nowPlaying: NowPlaying | null
}

/** 模型输出里的通用参数槽（所有动作共用一套 JSON Schema 字段） */
export interface SkillRaw {
  text: string
  target: string
  command: string
  value: number | null
  on: boolean | null
}

/** 门槛判定：可以执行（null）、只给一句说明、或当普通问题回答 */
export type SkillGate =
  | { kind: 'explain'; text: string }
  | { kind: 'answer' }
  | null

/** 卡片上的一个按钮：一次性动作，或在卡片列表下方展开一个面板 */
export interface AssistantCardAction {
  label: string
  primary?: boolean
  /** 一次性动作；返回 true 时收起助手 */
  run?: () => Promise<boolean>
  /** 在卡片列表下方展开的面板（再点一次收起）；面板发出 played 时收起助手 */
  panel?: { component: Component; props: Record<string, unknown> }
}

/** 一张影片结果卡（AssistantResults 用 UiMediaRow 显示） */
export interface AssistantMediaCard {
  id: string
  title: string
  /** 竖版海报地址；没有时显示占位 */
  image: string | null
  /** 一行说明（年份 · 类型 · 时长或季集） */
  meta: string
  /** 规格标签（4K、DOLBY VISION、中字…）；没有时不显示 */
  specs?: SpecBadge[]
  /** 评分文字（金星之后，如「8.1」「豆瓣 8.2」） */
  rating?: string
  /** 推荐理由（「AI 理解 · 科幻」） */
  reason?: string
  /** 来源（「本地片库」「豆瓣」） */
  source?: string
  /** 进度 0–1 */
  progress?: number
  /** 看到哪儿（「第 1 季 · 第 12 集 · 剩 18 分钟」） */
  progressNote?: string
  /** 片库条目的卡片信息：有它才有「详情」（整卡点开）与「想看」 */
  library?: LibraryCardInfo
  /** 按钮 / 无障碍文字 */
  playLabel: string
  /** 开始播放；找不到可播放的内容时返回 false */
  play: () => Promise<boolean>
  /** 备注里的状态字（如「未入库」），随状态变化 */
  tag?: () => string
  /** 有按钮时卡片右侧换成这些按钮（随状态变化） */
  actions?: () => AssistantCardAction[]
}

/** 面板里的结果 */
export type AssistantResult =
  | { kind: 'cards'; cards: AssistantMediaCard[] }
  /** 一次性动作的回执 */
  | { kind: 'done'; ok: boolean; icon: IconName; text: string }

/** 一次动作的结果：要说的话、结果、是否收起助手 */
export interface ActionOutcome {
  message: string
  result: AssistantResult | null
  close?: boolean
}

/** 执行动作时可用的应用能力 */
export interface SkillEnv {
  router: Router
  /** 打开设置面板的某个分区 */
  openSettings: (section: string) => void
  signal: AbortSignal
}

/** 一个动作（参数类型已擦除，见 {@link defineAction}） */
export interface SkillAction {
  /** 技能包内唯一；对模型的完整动作名是 `<技能 id>.<name>` */
  name: string
  /** 提示词里的一行：什么时候用、各参数槽怎么填 */
  describe: string
  /** 参数校验：不合格返回 null */
  parse: (raw: SkillRaw) => unknown
  /** 按当前状态判定能不能执行 */
  gate?: (params: unknown, context: AssistantContext) => SkillGate
  run: (params: unknown, env: SkillEnv) => Promise<ActionOutcome>
}

/** defineAction 的参数：带参数类型 */
export interface SkillActionSpec<P> {
  name: string
  describe: string
  parse: (raw: SkillRaw) => P | null
  gate?: (params: P, context: AssistantContext) => SkillGate
  run: (params: P, env: SkillEnv) => Promise<ActionOutcome>
}

/** 技能生效范围：普通模式、私密模式、两者都可 */
export type SkillScope = 'normal' | 'private' | 'any'

/** 一个技能包 */
export interface AssistantSkill {
  id: string
  scope: SkillScope
  actions: SkillAction[]
  /** 追加到系统提示词的说明 */
  prompt?: (context: AssistantContext) => string[]
  /** 建议胶囊（按顺序，核心取前几条） */
  suggestions?: (context: AssistantContext) => string[]
  /** 输入框占位文字（私密技能用） */
  placeholder?: string
}

/** 声明一个动作：保留参数类型写执行器，注册时擦除成 {@link SkillAction} */
export function defineAction<P>(spec: SkillActionSpec<P>): SkillAction {
  const { gate } = spec
  return {
    name: spec.name,
    describe: spec.describe,
    parse: spec.parse,
    gate: gate ? (params, context) => gate(params as P, context) : undefined,
    run: (params, env) => spec.run(params as P, env),
  }
}

/** 收起助手、不再说话的动作结果（跳转页面、打开设置等） */
export const closeOutcome: ActionOutcome = {
  message: '',
  result: null,
  close: true,
}
