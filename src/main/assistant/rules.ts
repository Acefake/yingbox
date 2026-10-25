/**
 * AI 助手主进程的纯规则：全局快捷键的写法校验与规整、注册状态机、转写结果拼成一句话。
 * 不依赖 electron，便于测试；接线在同目录的 index.ts。
 */
import type {
  AssistantShortcutProblem,
  AssistantShortcutStatus,
} from '../../shared/assistant'

/** 修饰键别名 → Electron 规范写法 */
const MODIFIERS: Record<string, string> = {
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
}

/** 修饰键的排列顺序（规整后同一组合只有一种写法） */
const MODIFIER_ORDER = [
  'CommandOrControl',
  'Command',
  'Control',
  'Alt',
  'AltGr',
  'Shift',
  'Super',
]

/** 具名按键（小写 → 规范写法） */
const NAMED_KEYS: Record<string, string> = Object.fromEntries(
  [
    'Space',
    'Tab',
    'Backspace',
    'Delete',
    'Insert',
    'Return',
    'Enter',
    'Up',
    'Down',
    'Left',
    'Right',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Escape',
    'Plus',
  ].map(key => [key.toLowerCase(), key])
)

/** 单个符号键 */
const PUNCTUATION = new Set([..."`-=[]\\;',./"])

/** 规整按键名；认不出返回 null */
function normalizeKey(raw: string): string | null {
  const lower = raw.toLowerCase()
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase()
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase()
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower]
  if (lower === 'esc') return 'Escape'
  if (PUNCTUATION.has(raw)) return raw
  return null
}

/**
 * 校验并规整快捷键写法（大小写、别名、修饰键顺序）。
 * 必须恰好一个主键；除 F1–F24 外至少带一个修饰键（不抢普通打字）。
 * @returns 规整后的写法；空串表示关闭；写法不合法返回 null
 */
export function normalizeAccelerator(raw: string): string | null {
  const text = raw.trim()
  if (!text) return ''
  const parts = text.split('+').map(part => part.trim())
  if (parts.some(part => !part)) return null
  const modifiers = new Set<string>()
  const keys: string[] = []
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()]
    if (modifier) modifiers.add(modifier)
    else {
      const key = normalizeKey(part)
      if (!key) return null
      keys.push(key)
    }
  }
  if (keys.length !== 1) return null
  const key = keys[0]
  if (!modifiers.size && !/^F\d+$/.test(key)) return null
  const ordered = MODIFIER_ORDER.filter(name => modifiers.has(name))
  return [...ordered, key].join('+')
}

/** 快捷键注册所需的系统能力（主进程传 globalShortcut，测试传替身） */
export interface ShortcutRegistry {
  /** 注册；被占用返回 false，写法不被系统接受时可能抛错 */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  /** 本应用是否已经注册了这个组合（其他功能占着时不抢） */
  isRegistered(accelerator: string): boolean
}

/** 快捷键控制器：按设置注册 / 换绑 / 关闭，并给出当前状态 */
export interface ShortcutController {
  /**
   * 应用设置里的写法，返回新状态。同一写法已注册且仍在系统里时不重复注册；
   * 换绑时先注册新组合，成功后才注销旧的，新组合不可用时旧的继续生效（状态里给出 active）。
   */
  apply(raw: string): AssistantShortcutStatus
  /** 当前状态：以系统里是否真的注册着为准，被外部注销时先重新注册一次 */
  status(): AssistantShortcutStatus
  /** 注销（应用退出时） */
  dispose(): void
}

/**
 * 创建快捷键控制器。
 * @param registry 系统注册能力
 * @param onTrigger 按下快捷键时调用
 */
export function createShortcutController(
  registry: ShortcutRegistry,
  onTrigger: () => void
): ShortcutController {
  let current: AssistantShortcutStatus = { accelerator: '', registered: false }
  /** 本控制器实际注册着的组合 */
  let held: string | null = null

  /** 仍在系统里的已注册组合；被外部注销（如 unregisterAll）时清掉记录 */
  const holding = (): string | null => {
    if (held !== null && !registry.isRegistered(held)) held = null
    return held
  }

  const fail = (
    accelerator: string,
    problem: AssistantShortcutProblem,
    active: string | null
  ): AssistantShortcutStatus =>
    active
      ? { accelerator, registered: false, problem, active }
      : { accelerator, registered: false, problem }

  /** 注册新组合（调用方保证它不是 held） */
  const tryRegister = (
    accelerator: string
  ): AssistantShortcutProblem | null => {
    if (registry.isRegistered(accelerator)) return 'conflict'
    try {
      return registry.register(accelerator, onTrigger) ? null : 'conflict'
    } catch {
      return 'invalid'
    }
  }

  const apply = (raw: string): AssistantShortcutStatus => {
    const accelerator = normalizeAccelerator(raw)
    const live = holding()
    if (accelerator === null) {
      current = fail(raw.trim(), 'invalid', live)
      return current
    }
    if (accelerator === '') {
      if (live) registry.unregister(live)
      held = null
      current = { accelerator, registered: false }
      return current
    }
    if (live === accelerator) {
      current = { accelerator, registered: true }
      return current
    }
    const problem = tryRegister(accelerator)
    if (problem) {
      current = fail(accelerator, problem, live)
      return current
    }
    if (live) registry.unregister(live)
    held = accelerator
    current = { accelerator, registered: true }
    return current
  }

  return {
    apply,
    status() {
      if (current.registered && holding() === null)
        return apply(current.accelerator)
      return current
    },
    dispose() {
      const live = holding()
      if (live) registry.unregister(live)
      held = null
      current = { accelerator: current.accelerator, registered: false }
    },
  }
}

/** 转写的各段文字拼成一句（去掉空段与首尾空白，中文之间不加空格） */
export function transcriptText(cues: readonly { text: string }[]): string {
  let out = ''
  for (const cue of cues) {
    const text = cue.text.trim()
    if (!text) continue
    const needSpace =
      out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(text)
    out += needSpace ? ` ${text}` : text
  }
  return out
}

/**
 * 16 位 PCM WAV 的时长（秒）：按 RIFF 块遍历，取 fmt 块的 byteRate 与 data 块的长度
 * （data 前有 LIST 等附加块时也算对）；不是 RIFF/WAVE 或缺块时返回 0。
 */
export function wavSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 12) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 0
  let byteRate = 0
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.byteLength)
      byteRate = view.getUint32(body + 8, true)
    if (id === 'data') {
      const length = Math.min(size, bytes.byteLength - body)
      return byteRate > 0 ? length / byteRate : 0
    }
    // 块按偶数字节对齐
    offset = body + size + (size % 2)
  }
  return 0
}
