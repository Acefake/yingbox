/**
 * 播放器技能包：控制正在播放的视频（弹幕、不透明度、字幕、睡眠定时、跳过片头、倍速）与问剧情。
 * 普通与私密模式都生效；只在内置播放器播放中可用，经播放器的遥控入口执行。
 */
import type { IconName } from '@/components/ui'
import {
  type PlayerRemoteCommand,
  type SleepChoice,
  askPlotQuestion,
  runPlayerCommand,
} from '@/features/player'

import {
  type AssistantSkill,
  type SkillGate,
  type SkillRaw,
  closeOutcome,
  defineAction,
} from './skill-types'

/** 睡眠定时的写法 → 选项；认不出返回 null */
function sleepChoice(target: string, value: number | null): SleepChoice | null {
  if (target === 'off' || target === 'episode') return target
  const minutes = Number(target) || value
  return minutes === 30 || minutes === 60 || minutes === 90 ? minutes : null
}

/** 播放器命令的参数校验；不合格返回 null */
export function parsePlayerCommand(raw: SkillRaw): PlayerRemoteCommand | null {
  const { on, value } = raw
  switch (raw.command) {
    case 'danmaku':
    case 'subtitle':
      return typeof on === 'boolean' ? { kind: raw.command, on } : null
    case 'danmakuOpacity': {
      // 模型偶尔给百分数（50 表示 50%）
      const ratio =
        value !== null && value > 1 && value <= 100 ? value / 100 : value
      return ratio !== null && ratio >= 0.1 && ratio <= 1
        ? { kind: 'danmakuOpacity', value: ratio }
        : null
    }
    case 'sleep': {
      const choice = sleepChoice(raw.target, value)
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

/** 播放器命令的图标 */
const PLAYER_ICONS: Record<PlayerRemoteCommand['kind'], IconName> = {
  danmaku: 'subtitle',
  danmakuOpacity: 'subtitle',
  subtitle: 'subtitle',
  sleep: 'moon',
  skipIntro: 'skipForward',
  rate: 'play',
}

const control = defineAction<PlayerRemoteCommand>({
  name: 'control',
  describe:
    '控制正在播放的视频；command 取 danmaku（开关弹幕，on）、danmakuOpacity（弹幕不透明度，value 取 0.1–1）、subtitle（开关字幕，on）、sleep（睡眠定时，target 取 off / episode / 30 / 60 / 90）、skipIntro（跳过片头）、rate（倍速，value 取 0.25–4）。',
  parse: parsePlayerCommand,
  gate(_command, context): SkillGate {
    if (!context.playing)
      return {
        kind: 'explain',
        text: '现在没有正在播放的视频，开始播放后再让我调。',
      }
    if (!context.controllable)
      return { kind: 'explain', text: '外置播放器播放时不能在这里控制。' }
    return null
  },
  async run(command) {
    const outcome = runPlayerCommand(command)
    // 回执只放在结果卡片里，不再逐字重复一遍（逐字部分用模型的 reply）
    return {
      message: '',
      result: {
        kind: 'done',
        ok: outcome.ok,
        icon: outcome.ok ? PLAYER_ICONS[command.kind] : 'info',
        text: outcome.text,
      },
    }
  },
})

const plot = defineAction<string>({
  name: 'plot',
  describe: '问正在看的剧情（人物、前面发生了什么）；text 写问题。',
  parse: raw => raw.text || null,
  gate(_question, context): SkillGate {
    if (!context.playing) return { kind: 'answer' }
    if (!context.plotQa)
      return {
        kind: 'explain',
        text: '这个视频暂时不能问剧情：需要本地视频，并且之前的集生成过 AI 字幕。',
      }
    return null
  },
  async run(question) {
    return askPlotQuestion(question)
      ? closeOutcome
      : { message: '这个视频暂时不能问剧情。', result: null }
  },
})

/** 播放器技能包 */
export const playerSkill: AssistantSkill = {
  id: 'player',
  scope: 'any',
  actions: [control, plot],
  suggestions: context =>
    context.playing
      ? ['关掉弹幕', '1.5 倍速', '30 分钟后停止播放', '刚才发生了什么']
      : [],
}
