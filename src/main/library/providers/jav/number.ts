/**
 * 番号解析：从视频文件名（必要时退到所在文件夹名）里认出番号，并归一成站点通用的写法。
 *
 * 支持的形态（按优先级）：
 * - FC2：`FC2-PPV-1234567` / `FC2PPV_1234567` / `fc2-1234567` → `FC2-PPV-1234567`；
 * - HEYZO：`HEYZO-0841` / `heyzo_841` → `HEYZO-0841`；
 * - 金髪天國：`KIN8-3997` / `kin8tengoku_3997` / `KIN8-123` → `KIN8-3997` / `KIN8-0123`（数字补零到 4 位）；
 * - 日期型无码（Carib / 1pon / 10musume / Pacopacomama）：`010120-001`、`010120_001`（保留原分隔符）；
 * - 素人带数字前缀：`259LUXU-1234`、`300MIUM-123`；
 * - 常规：`SSIS-497`、`abp_123`、`ABP 123`、`SSIS497`、DMM 连写 `ssis00497` → `SSIS-497`；
 * - Tokyo-Hot：`n1234`（小写保留）。
 *
 * 解析前去掉常见噪声：`xxx.com@` 前缀、方括号里的站点 / 字幕组标记、分辨率与编码标记；
 * 识别 -C / -UC / 中文字幕（字幕版）与 CD1 / part2 / -1（分段），这些不进番号。
 */
import type { JavKind } from '../../../../shared/library/ipc'

/** 番号类别：决定去哪些站点查（定义在共享契约，番号页的「类型」筛选也用它）。 */
export type JavCodeKind = JavKind

/** 解析结果。 */
export interface JavCode {
  /** 归一后的番号，如 SSIS-497、FC2-PPV-1234567、HEYZO-0841、010120-001。 */
  code: string
  kind: JavCodeKind
  /** 分段序号（CD1 / part2 / 末尾 -1）。 */
  part?: number
  /** 文件名标了字幕版（-C / -UC / 中文字幕）。 */
  subtitle: boolean
}

/** 分辨率、编码等标记：两侧须是分隔符，避免误伤番号本身。 */
const NOISE_TOKENS = [
  '2160P',
  '1440P',
  '1080P',
  '720P',
  '480P',
  '4K',
  '8K',
  'FHD',
  'UHD',
  'HEVC',
  'H264',
  'H265',
  'X264',
  'X265',
  'AVC',
  'AAC',
  'VR',
  'FULL',
  'DVD',
  'WEB',
  'WEBDL',
]
const NOISE_RE = new RegExp(
  `(^|[-_ .])(?:${NOISE_TOKENS.join('|')})(?=[-_ .]|$)`,
  'g'
)

/** 常见无码厂牌前缀（只影响去哪些站点查，不影响番号写法）。 */
const UNCENSORED_PREFIXES = new Set([
  'HEYZO',
  'SKYHD',
  'CWPBD',
  'CWP',
  'LAFBD',
  'LAF',
  'SMD',
  'SMBD',
  'MKBD',
  'MKD',
  'RED',
  'S2M',
  'S2MBD',
  'BT',
  'CT',
  'EMP',
  'DSAM',
  'DRC',
  'DRG',
  'KTG',
  'MCDV',
  'MCB3D',
  'PT',
  'SSKP',
  'TRG',
])

/** 不当作番号前缀的字母段（编码 / 容器 / 分段标记残留）。 */
const FAKE_PREFIXES = new Set([
  'CD',
  'PART',
  'DISC',
  'MP',
  'FC',
  'EP',
  'VOL',
  'NO',
])

/** 文件名去扩展名。 */
const stemOf = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? name
  return base.replace(/\.[A-Za-z0-9]{2,5}$/, '')
}

/** 去噪：站点前缀、方括号标记、分辨率 / 编码标记，统一大写。 */
function clean(stem: string): string {
  let s = stem.normalize('NFKC').toUpperCase()
  // 「hhd800.com@SSIS-497」一类下载站前缀
  s = s.replace(/^[^@]*@/, '')
  // 方括号 / 圆括号里的内容常是站点名、字幕组，但也可能就是番号：番号外面有内容时才去掉
  const outside = s.replace(/[[【(（][^\]】)）]*[\]】)）]/g, ' ').trim()
  if (/[A-Z0-9]/.test(outside)) s = outside
  // 域名（javbus.com、www.xxx.net）
  s = s.replace(
    /\b(?:WWW\.)?[A-Z0-9-]+\.(?:COM|NET|ORG|CC|TV|XYZ|ME|LA|VIP|CLUB)\b/g,
    ' '
  )
  s = s.replace(NOISE_RE, '$1')
  return s
}

/** 分段：CD1 / PART2 / DISC1，或番号后紧跟的 -1 / -2（只认 1–9）。 */
function partOf(rest: string): number | undefined {
  const marked = /(?:^|[-_ .])(?:CD|PART|DISC|PT)[-_ .]?(\d{1,2})(?!\d)/.exec(
    rest
  )
  if (marked) return Number(marked[1])
  const tail = /^[-_ .]([1-9])(?![0-9A-Z])/.exec(rest)
  return tail ? Number(tail[1]) : undefined
}

/** 字幕版：番号后的 -C / -UC / _C，或文件名里的「中文字幕 / 中字 / 字幕」。 */
function subtitleOf(rest: string, whole: string): boolean {
  return /^[-_ .]U?C(?![A-Z0-9])/.test(rest) || /中文字幕|中字|字幕/.test(whole)
}

/** 前缀判类别。 */
function kindOfPrefix(prefix: string): JavCodeKind {
  if (/^\d+[A-Z]+$/.test(prefix)) return 'amateur'
  if (prefix === 'SIRO') return 'amateur'
  return UNCENSORED_PREFIXES.has(prefix) ? 'uncensored' : 'censored'
}

/** 一次匹配：番号、类别，以及番号之后的剩余文本（找分段 / 字幕标记用）。 */
interface Hit {
  code: string
  kind: JavCodeKind
  rest: string
}

/** 数字段：去掉多余前导零后至少保留 3 位（SSIS-0497 → SSIS-497，ABP-01 → ABP-001）。 */
function digits(raw: string): string {
  const n = String(Number(raw))
  return n.length >= 3 ? n : n.padStart(3, '0')
}

/** 按优先级逐个尝试的规则；strict 只用于文件夹名（不做过宽的连写匹配）。 */
function match(s: string, strict: boolean): Hit | null {
  const after = (m: RegExpExecArray): string => s.slice(m.index + m[0].length)
  let m: RegExpExecArray | null

  if ((m = /FC2[-_ ]*(?:PPV[-_ ]*)?(\d{5,8})(?!\d)/.exec(s))) {
    return { code: `FC2-PPV-${m[1]}`, kind: 'fc2', rest: after(m) }
  }
  if ((m = /HEYZO[-_ ]*(\d{3,4})(?!\d)/.exec(s))) {
    return {
      code: `HEYZO-${m[1].padStart(4, '0')}`,
      kind: 'uncensored',
      rest: after(m),
    }
  }
  // 金髪天國：站点编号恰好 4 位（补零），超过 4 位不是它的番号
  if ((m = /(?<![0-9A-Z])KIN8(?:TENGOKU)?[-_ ]*(\d{1,4})(?!\d)/.exec(s))) {
    if (Number(m[1]) > 0) {
      return {
        code: `KIN8-${m[1].padStart(4, '0')}`,
        kind: 'uncensored',
        rest: after(m),
      }
    }
  }
  if ((m = /(?<![0-9A-Z])(\d{6})([-_])(\d{2,3})(?!\d)/.exec(s))) {
    return { code: `${m[1]}${m[2]}${m[3]}`, kind: 'uncensored', rest: after(m) }
  }
  if ((m = /(?<![0-9A-Z])(\d{3,4}[A-Z]{2,6})[-_ ]?(\d{3,5})(?!\d)/.exec(s))) {
    return { code: `${m[1]}-${digits(m[2])}`, kind: 'amateur', rest: after(m) }
  }
  // 常规：字母 2–6 位 + 分隔符 + 数字 2–5 位（可带 Z / E 一类单字母尾缀）
  const dashed = /(?<![A-Z0-9])([A-Z]{2,6})[-_ ](\d{2,5})(?!\d)/g
  while ((m = dashed.exec(s))) {
    if (FAKE_PREFIXES.has(m[1])) continue
    return {
      code: `${m[1]}-${digits(m[2])}`,
      kind: kindOfPrefix(m[1]),
      rest: after(m),
    }
  }
  if (strict) return null
  // DMM 连写：ssis00497 → SSIS-497
  if (
    (m = /(?<![A-Z0-9])([A-Z]{2,6})00(\d{3})(?!\d)/.exec(s)) &&
    !FAKE_PREFIXES.has(m[1])
  ) {
    return { code: `${m[1]}-${m[2]}`, kind: kindOfPrefix(m[1]), rest: after(m) }
  }
  // 无分隔符：SSIS497
  const bare = /(?<![A-Z0-9])([A-Z]{2,6})(\d{3,5})(?!\d)/g
  while ((m = bare.exec(s))) {
    if (FAKE_PREFIXES.has(m[1])) continue
    return {
      code: `${m[1]}-${digits(m[2])}`,
      kind: kindOfPrefix(m[1]),
      rest: after(m),
    }
  }
  if ((m = /(?<![A-Z0-9])N(\d{4})(?!\d)/.exec(s))) {
    return { code: `n${m[1]}`, kind: 'uncensored', rest: after(m) }
  }
  return null
}

/**
 * 从文件名解析番号；文件名里没有时依次尝试所在文件夹名（从近到远，只用严格规则）。
 * 认不出返回 null（不会把原文件名当番号）。
 *
 * @param fileName 文件名或路径（只取最后一段）
 * @param dirNames 所在的各级文件夹名，从根到近
 */
export function parseJavCode(
  fileName: string,
  dirNames: readonly string[] = []
): JavCode | null {
  const stem = stemOf(fileName)
  const cleaned = clean(stem)
  const hit = match(cleaned, false)
  if (hit) {
    const part = partOf(hit.rest)
    return {
      code: hit.code,
      kind: hit.kind,
      ...(part !== undefined ? { part } : {}),
      subtitle: subtitleOf(hit.rest, stem),
    }
  }
  for (const dir of [...dirNames].reverse()) {
    const dirHit = match(clean(dir), true)
    if (dirHit) {
      const part = partOf(cleaned)
      return {
        code: dirHit.code,
        kind: dirHit.kind,
        ...(part !== undefined ? { part } : {}),
        subtitle: subtitleOf('', stem),
      }
    }
  }
  return null
}

/**
 * 番号比较键：去掉分隔符与大小写，数字段去前导零（SSIS-049 与 ssis49 相同）。
 * 站点检索结果是模糊匹配，用它逐条核对。
 */
export function codeKey(code: string): string {
  return (code.toLowerCase().match(/\d+|[a-z]+/g) ?? [])
    .map(part => (/^\d+$/.test(part) ? String(Number(part)) : part))
    .join('')
}
