/**
 * 模型输出里的 JSON 容错解析（纯函数）。
 *
 * 即使开了 JSON 模式，部分模型 / 服务商仍会：包一层 ```json 代码块、前后加说明文字、
 * 留尾逗号，或在推理模型里先输出 <think>…</think>。这里按顺序尝试：
 * 原文 → 去掉 think 与代码块 → 截取第一个配平的 {…} / […] → 再去尾逗号。
 */

/** 解析失败时返回 undefined（调用方转成 bad_json 错误） */
export function parseJsonLoose(text: string): unknown {
  const candidates: string[] = []
  const trimmed = text.trim()
  candidates.push(trimmed)
  const cleaned = stripFences(stripThink(trimmed))
  candidates.push(cleaned)
  const block = extractBalanced(cleaned)
  if (block) {
    candidates.push(block)
    candidates.push(removeTrailingCommas(block))
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // 继续下一种
    }
  }
  return undefined
}

/** 去掉推理模型的 <think>…</think> 段 */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/** 去掉 Markdown 代码块外壳（取第一个代码块的内容） */
function stripFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text)
  return (fence ? fence[1] : text).trim()
}

/** 截取第一个配平的 JSON 对象或数组（跳过字符串里的括号） */
function extractBalanced(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start < 0) return null
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

/** 去掉对象 / 数组结尾多余的逗号（不处理字符串内部） */
function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}
