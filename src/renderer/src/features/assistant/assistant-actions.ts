/**
 * AI 助手的动作适配：把校验过的意图交给已有模块执行，并给出面板上的结果卡片。
 *
 * - 推荐：「今晚看什么」同一套逻辑（suggestTonight），海报卡片点击即播；
 * - 继续播放：「继续播放」记录（私密板块 jav / av 的记录不出现），卡片带进度条；
 * - 搜索：跳到媒体库，搜索框写成「? + 描述」强制交给自然语言搜索解析；
 * - 播放器控制 / 问剧情：经播放器的遥控入口；跳转页面、打开设置分区直接收起助手。
 * 页面跳转只去 ASSISTANT_PAGES 清单里的页面，不会进入私密板块。
 */
import type { Router } from 'vue-router'

import type { IconName } from '@/components/ui'
import { playTonightPick, suggestTonight } from '@/features/library'
import {
  type ContinueRecord,
  askPlotQuestion,
  continueRecords,
  metaOf,
  openMediaPlayer,
  progressRatio,
  replayOptions,
  runPlayerCommand,
} from '@/features/player'

import {
  ASSISTANT_PAGES,
  type AssistantIntent,
  type AssistantSettingsSection,
} from './assistant-intents'

/** 一张海报卡片（推荐 / 继续播放共用） */
export interface AssistantMediaCard {
  id: string
  title: string
  /** 海报地址；没有时显示占位 */
  image: string | null
  /** 一行说明（时长评分、集名、剩余时间） */
  meta: string
  /** 推荐理由 */
  reason?: string
  /** 进度 0–1（继续播放才有） */
  progress?: number
  /** 按钮文字 */
  playLabel: string
  /** 开始播放；找不到可播放的内容时返回 false */
  play: () => Promise<boolean>
}

/** 面板里的结果卡片 */
export type AssistantResult =
  | { kind: 'picks'; cards: AssistantMediaCard[] }
  | { kind: 'continue'; cards: AssistantMediaCard[] }
  /** 播放器控制等一次性动作的回执 */
  | { kind: 'done'; ok: boolean; icon: IconName; text: string }

/** 一次动作的结果：要说的话、卡片、是否收起助手 */
export interface ActionOutcome {
  message: string
  result: AssistantResult | null
  close?: boolean
}

/** 动作执行需要的应用能力 */
export interface ActionHost {
  router: Router
  /** 打开设置面板的某个分区 */
  openSettings: (section: AssistantSettingsSection) => void
}

/** 继续播放卡片最多几张 */
const CONTINUE_CARDS = 3
/** 不在助手里出现的私密板块 */
const PRIVATE_SECTIONS = new Set(['jav', 'av'])

/** 剩余时间的说明 */
function remainingText(record: ContinueRecord): string {
  if (record.nextUp) return '下一集'
  if (!(record.duration > 0)) return ''
  const minutes = Math.max(
    1,
    Math.round((record.duration - record.progress) / 60)
  )
  return `剩 ${minutes} 分钟`
}

/** 继续播放记录 → 卡片 */
function continueCard(record: ContinueRecord): AssistantMediaCard {
  return {
    id: record.id,
    title: record.title,
    image: record.cover ?? null,
    meta: [record.episode, remainingText(record)].filter(Boolean).join(' · '),
    progress: progressRatio(record),
    playLabel: '继续播放',
    play: () =>
      openMediaPlayer({ ...replayOptions(record), continueAs: metaOf(record) }),
  }
}

/** 最近在看、可以在助手里出现的记录（私密板块除外） */
export function visibleContinueRecords(
  records: readonly ContinueRecord[]
): ContinueRecord[] {
  return records
    .filter(record => !PRIVATE_SECTIONS.has(record.section))
    .slice(0, CONTINUE_CARDS)
}

/** 播放器命令的图标 */
const PLAYER_ICONS: Record<string, IconName> = {
  danmaku: 'subtitle',
  danmakuOpacity: 'subtitle',
  subtitle: 'subtitle',
  sleep: 'moon',
  skipIntro: 'skipForward',
  rate: 'play',
}

/** 执行一个意图的函数 */
export type ExecuteIntent = (
  intent: AssistantIntent,
  signal: AbortSignal
) => Promise<ActionOutcome>

/** 创建动作执行器 */
export function createAssistantActions(host: ActionHost): ExecuteIntent {
  /**
   * 执行一个意图（answer 不经这里）。
   * @param signal 取消（推荐时会取消模型调用）
   */
  return async function execute(
    intent: AssistantIntent,
    signal: AbortSignal
  ): Promise<ActionOutcome> {
    switch (intent.kind) {
      case 'recommend': {
        const { suggestions, notice } = await suggestTonight(
          intent.note,
          signal
        )
        const cards = suggestions.map(item => ({
          id: String(item.pick.candidate.id),
          title: item.title,
          image: item.image,
          meta: item.meta,
          reason: item.reason,
          playLabel: item.resume ? '继续播放' : '播放',
          play: () => playTonightPick(item.pick),
        }))
        return {
          message:
            notice ??
            (cards.length
              ? '今晚可以看看这几部。'
              : '媒体库里暂时挑不出合适的片子，先扫描或刮削一下媒体库吧。'),
          result: cards.length ? { kind: 'picks', cards } : null,
        }
      }
      case 'continue': {
        const cards = visibleContinueRecords(continueRecords().value).map(
          continueCard
        )
        return {
          message: cards.length
            ? '接着看上次没看完的：'
            : '还没有看到一半的内容。',
          result: cards.length ? { kind: 'continue', cards } : null,
        }
      }
      case 'search':
        await host.router.push({
          path: ASSISTANT_PAGES[intent.section].path,
          query: { q: `?${intent.query}` },
        })
        return { message: '', result: null, close: true }
      case 'player': {
        const outcome = runPlayerCommand(intent.command)
        return {
          message: outcome.text,
          result: {
            kind: 'done',
            ok: outcome.ok,
            icon: outcome.ok
              ? (PLAYER_ICONS[intent.command.kind] ?? 'check')
              : 'info',
            text: outcome.text,
          },
        }
      }
      case 'navigate':
        await host.router.push(ASSISTANT_PAGES[intent.page].path)
        return { message: '', result: null, close: true }
      case 'settings':
        host.openSettings(intent.section)
        return { message: '', result: null, close: true }
      case 'plot':
        return askPlotQuestion(intent.question)
          ? { message: '', result: null, close: true }
          : { message: '这个视频暂时不能问剧情。', result: null }
      case 'answer':
        return { message: '', result: null }
    }
  }
}
