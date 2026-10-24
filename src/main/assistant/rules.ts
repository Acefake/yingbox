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
  /** 应用设置里的写法，返回新状态（同一写法已注册时不重复注册） */
  apply(raw: string): AssistantShortcutStatus
  /** 当前状态 */
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

  const release = (): void => {
    if (current.registered) registry.unregister(current.accelerator)
  }

  const fail = (
    accelerator: string,
    problem: AssistantShortcutProblem
  ): AssistantShortcutStatus => ({ accelerator, registered: false, problem })

  const tryRegister = (accelerator: string): AssistantShortcutStatus => {
    if (registry.isRegistered(accelerator)) return fail(accelerator, 'conflict')
    try {
      return registry.register(accelerator, onTrigger)
        ? { accelerator, registered: true }
        : fail(accelerator, 'conflict')
    } catch {
      return fail(accelerator, 'invalid')
    }
  }

  return {
    apply(raw) {
      const accelerator = normalizeAccelerator(raw)
      if (
        accelerator &&
        current.registered &&
        current.accelerator === accelerator
      )
        return current
      release()
      if (accelerator === null) current = fail(raw.trim(), 'invalid')
      else if (accelerator === '') current = { accelerator, registered: false }
      else current = tryRegister(accelerator)
      return current
    },
    status: () => current,
    dispose() {
      release()
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

/** 16 位 PCM WAV 的时长（秒）；不是标准 44 字节头的 WAV 返回 0 */
export function wavSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(...bytes.subarray(0, 4))
  const wave = String.fromCharCode(...bytes.subarray(8, 12))
  if (riff !== 'RIFF' || wave !== 'WAVE') return 0
  const byteRate = view.getUint32(28, true)
  return byteRate > 0 ? (bytes.byteLength - 44) / byteRate : 0
}
