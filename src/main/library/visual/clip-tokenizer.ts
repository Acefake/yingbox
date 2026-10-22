/**
 * 中文 CLIP 的文本分词（BERT WordPiece，与 tokenizer.json 里的 BertNormalizer + BertPreTokenizer + WordPiece 一致）。
 *
 * 自己实现而不引 transformers.js：它在 Node 里连带加载 sharp 原生模块，打包和 NAS 镜像都麻烦；
 * 这里只需要把一句话变成 id 序列，几十行就够。
 *
 * 规则：清理控制字符 → 汉字两侧补空格 → 小写并去掉重音 → 按空白和标点切 → 每段按最长前缀匹配词表（续接加 ##）。
 * 首尾加 [CLS] / [SEP]，超长截断。
 */

/** 文本最长 token 数（含首尾），与 Chinese-CLIP 训练时的 context_length 一致。 */
export const CLIP_TEXT_LENGTH = 52

const CLS = '[CLS]'
const SEP = '[SEP]'
const UNK = '[UNK]'
/** 单个词超过这么多字符直接记为 [UNK]（WordPiece 的 max_input_chars_per_word）。 */
const MAX_WORD_CHARS = 100

/** 汉字区段（BERT 的 _is_chinese_char）。 */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  )
}

const PUNCT = /^\p{P}$/u

/** BERT 把 ASCII 里非字母数字的可见符号都算标点。 */
function isPunct(ch: string, cp: number): boolean {
  return (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126) ||
    PUNCT.test(ch)
  )
}

const CONTROL = /^[\p{Cc}\p{Cf}]$/u
const SPACE = /^\s$/u

/** 规范化：去控制字符、空白统一、汉字补空格、小写去重音。 */
function normalize(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0 || cp === 0xfffd) continue
    if (SPACE.test(ch)) out += ' '
    else if (CONTROL.test(ch)) continue
    else if (isCjk(cp)) out += ` ${ch} `
    else out += ch
  }
  return out
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
}

/** 按空白与标点切成词（标点各自成词）。 */
function preTokenize(text: string): string[] {
  const words: string[] = []
  for (const chunk of text.split(' ')) {
    let word = ''
    for (const ch of chunk) {
      if (isPunct(ch, ch.codePointAt(0)!)) {
        if (word) words.push(word)
        words.push(ch)
        word = ''
      } else word += ch
    }
    if (word) words.push(word)
  }
  return words
}

/** 中文 CLIP 分词器。vocab 是 token → id（tokenizer.json 的 model.vocab）。 */
export class ClipTokenizer {
  private readonly cls: number
  private readonly sep: number
  private readonly unk: number

  constructor(private readonly vocab: ReadonlyMap<string, number>) {
    const id = (token: string): number => {
      const found = vocab.get(token)
      if (found === undefined) throw new Error(`词表缺少 ${token}`)
      return found
    }
    this.cls = id(CLS)
    this.sep = id(SEP)
    this.unk = id(UNK)
  }

  /** 从 tokenizer.json 的内容构造。 */
  static fromJson(json: string): ClipTokenizer {
    const parsed = JSON.parse(json) as {
      model?: { vocab?: Record<string, number> }
    }
    const vocab = parsed.model?.vocab
    if (!vocab) throw new Error('tokenizer.json 缺少词表')
    return new ClipTokenizer(new Map(Object.entries(vocab)))
  }

  /** 一个词 → WordPiece id（最长前缀匹配，匹配不上整个词记 [UNK]）。 */
  private wordPiece(word: string): number[] {
    const chars = [...word]
    if (chars.length > MAX_WORD_CHARS) return [this.unk]
    const ids: number[] = []
    let start = 0
    while (start < chars.length) {
      let end = chars.length
      let found: number | undefined
      while (start < end) {
        const piece = (start > 0 ? '##' : '') + chars.slice(start, end).join('')
        found = this.vocab.get(piece)
        if (found !== undefined) break
        end--
      }
      if (found === undefined) return [this.unk]
      ids.push(found)
      start = end
    }
    return ids
  }

  /** 一句话 → id 序列（[CLS] … [SEP]，最长 CLIP_TEXT_LENGTH）。 */
  encode(text: string): number[] {
    const body = preTokenize(normalize(text)).flatMap(w => this.wordPiece(w))
    return [this.cls, ...body.slice(0, CLIP_TEXT_LENGTH - 2), this.sep]
  }
}
