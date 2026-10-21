/**
 * 维基百科纯文本正文 → 演员简介：导语 + 白名单章节（经历 / 人物 / 生平…），截到 1500 字。
 *
 * 输入是 MediaWiki TextExtracts（prop=extracts&explaintext&exsectionformat=wiki）的结果：
 * 章节标题形如「== 略歴 ==」，引用标记已去掉。作品 / 出演 / 脚注等章节不取。
 * 章节选择规则参考 Amane 的 wikipedia 演员爬虫，代码独立实现。
 */

/** 白名单章节关键字（日文、简繁中文、英文），标题包含任一即整节取用，子章节随之。 */
const SECTION_KEYWORDS = [
  '人物',
  '略歴',
  '経歴',
  '来歴',
  '生い立ち',
  'プロフィール',
  '私生活',
  '简历',
  '簡歷',
  '简介',
  '簡介',
  '经历',
  '經歷',
  '履历',
  '履歷',
  '略历',
  '略歷',
  '来历',
  '來歷',
  '生平',
  '生涯',
  '背景',
  '个人生活',
  '個人生活',
  'early life',
  'career',
  'biography',
  'personal life',
  'background',
]

export const OVERVIEW_MAX_CHARS = 1500
/** 剩余空间不足这么多就不再续接半段。 */
const MIN_TAIL_CHARS = 30
const SENTENCE_ENDS = '。．.！!？?…'
const HEADING = /^(={2,6})\s*(.+?)\s*\1$/

function isSelected(title: string): boolean {
  const lower = title.toLowerCase()
  return SECTION_KEYWORDS.some(k => lower.includes(k))
}

/** 纯文本正文 → 选中的段落（每段压缩空白）。 */
export function overviewBlocks(extract: string): string[] {
  const blocks: string[] = []
  /** 当前标题栈 [层级, 标题]；任一层命中白名单即选中。 */
  const headings: Array<[number, string]> = []
  let selected = true
  let pending = ''
  for (const rawLine of extract.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const h = HEADING.exec(line)
    if (h) {
      if (pending) blocks.push(pending)
      pending = ''
      const level = h[1].length
      while (headings.length && headings[headings.length - 1][0] >= level)
        headings.pop()
      headings.push([level, h[2]])
      selected = headings.some(([, t]) => isSelected(t))
      continue
    }
    if (!selected) continue
    const text = line.replace(/\s+/g, ' ')
    // 年表里单独一行的「2006年」并到下一段开头
    if (pending) {
      blocks.push(`${pending} ${text}`)
      pending = ''
    } else if (isLabel(text)) pending = text
    else blocks.push(text)
  }
  if (pending) blocks.push(pending)
  return blocks
}

/** 年表小标题：短、没有句末标点（如「2006年」「2015年 - 2016年」）。 */
function isLabel(text: string): boolean {
  return text.length <= 12 && ![...SENTENCE_ENDS].some(c => text.includes(c))
}

/** 截到句末并留一个省略号的位置，结果不超过 limit。 */
function cutAtSentence(text: string, limit: number): string {
  let head = text.slice(0, limit - 1)
  const cut = Math.max(...[...SENTENCE_ENDS].map(c => head.lastIndexOf(c)))
  if (cut >= 0) head = head.slice(0, cut + 1)
  return `${head.trimEnd()}…`
}

/** 段落按序拼接（段间空一行），放不下的那段截到句末。空正文返回 undefined。 */
export function clipOverview(
  blocks: readonly string[],
  max = OVERVIEW_MAX_CHARS
): string | undefined {
  let out = ''
  for (const block of blocks) {
    const sep = out ? '\n\n' : ''
    const room = max - out.length - sep.length
    if (block.length <= room) {
      out += sep + block
      continue
    }
    if (room >= MIN_TAIL_CHARS) out += sep + cutAtSentence(block, room)
    break
  }
  return out || undefined
}
