/**
 * 模型输出里的 JSON 容错解析（纯函数）。
 *
 * 即使开了 JSON 模式，部分模型 / 服务商仍会：包一层 ```json 代码块（有时没有收尾）、前后加说明文字
 * （说明里还可能带 [注意] 这类括号）、留尾逗号，或在推理模型里先输出 <think>…</think>
 * （被截断时没有闭合，有的服务商只留下 </think>）。这里按顺序尝试：
 * 原文 → 去掉 think 与代码块 → 依次从每个 { / [ 截取配平的片段 → 再去尾逗号。
 */

/** 最多尝试几个起点（防止超长的说明文字拖慢解析） */
const MAX_STARTS = 32

/** 解析失败时返回 undefined（调用方转成 bad_json 错误） */
export function parseJsonLoose(text: string): unknown {
  return parseCandidates(text, 'first')
}

/**
 * 从思考过程里找答案：取最后一个能解析的 JSON 对象（思考里常先写草稿再定稿）。
 * 只在正文为空时作兜底。
 */
export function parseLastJson(text: string): unknown {
  return parseCandidates(text, 'last')
}

function tryParse(candidate: string): unknown {
  if (!candidate) return undefined
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}

function parseCandidates(text: string, pick: 'first' | 'last'): unknown {
  const trimmed = text.trim()
  if (pick === 'first') {
    const direct = tryParse(trimmed)
    if (direct !== undefined) return direct
  }
  const cleaned = stripFences(stripThink(trimmed))
  if (pick === 'first') {
    const plain = tryParse(cleaned)
    if (plain !== undefined) return plain
  }
  let found: unknown = undefined
  for (const data of balancedValues(cleaned)) {
    if (pick === 'first') return data
    if (data && typeof data === 'object' && !Array.isArray(data)) found = data
  }
  return found
}

/** 去掉推理模型的思考段：闭合的整段删掉；只剩 </think> 时取其后；未闭合的 <think> 取其前 */
function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const close = out.toLowerCase().lastIndexOf('</think>')
  if (close >= 0) out = out.slice(close + '</think>'.length)
  const open = out.toLowerCase().indexOf('<think>')
  if (open >= 0) out = out.slice(0, open)
  return out.trim()
}

/** 去掉 Markdown 代码块外壳（取第一个代码块的内容；没有收尾 ``` 时去掉开头那行） */
function stripFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text)
  if (fence) return fence[1].trim()
  return text.replace(/^```(?:json|JSON)?\s*\n?/, '').trim()
}

/**
 * 依次从每个 { / [ 起点截取配平的片段（跳过字符串里的括号）并解析，产出能解析的值；
 * 解析成功后跳到片段末尾（不再产出它里面嵌套的对象）。最多试 {@link MAX_STARTS} 个起点。
 */
function* balancedValues(text: string): Generator<unknown> {
  let from = 0
  for (let n = 0; n < MAX_STARTS; n++) {
    const offset = text.slice(from).search(/[{[]/)
    if (offset < 0) return
    const start = from + offset
    const block = extractBalanced(text, start)
    const data = block
      ? (tryParse(block) ?? tryParse(removeTrailingCommas(block)))
      : undefined
    if (data !== undefined) {
      yield data
      from = start + block!.length
    } else from = start + 1
  }
}

/** 从 start 处截取一个配平的 JSON 对象或数组；配不平返回 null */
function extractBalanced(text: string, start: number): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null
      if (stack.length === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 去掉对象 / 数组结尾多余的逗号：逐字扫描并跟踪字符串 / 转义状态，
 * 只删字符串外、后面（跳过空白）紧跟 } 或 ] 的逗号，字符串内容原样保留。
 */
export function removeTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += ch
  }
  return out
}
