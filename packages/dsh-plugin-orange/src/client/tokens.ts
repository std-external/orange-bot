/**
 * Message text -> what the panel draws. Pure and separate from React, so the nesting behaviour is
 * testable offline (`node vm/debug/token-test.ts`).
 *
 * The interesting case is a merged forward, which nests: the old non-greedy regex cut the outer
 * block at the inner `</forward>` and the rest of the message leaked out as raw text. Now a forward
 * becomes one token whose `nested` are the tokens of its own body, recursively (see markup.ts).
 */
import { humanText, splitMarkup, stripStrayTags, type MarkupPart } from '../markup.ts'

export type Token =
  | { kind: 'text', text: string }
  /** `[图片 #12]` / `[表情 #12]`: an attachment id, viewable through the media API anywhere. */
  | { kind: 'image', id: number, sticker: boolean }
  /** `[图片#1]` / `[表情#1]`: the old numbering, only meaningful for the message's own media. */
  | { kind: 'legacy', index: number, sticker: boolean }
  | { kind: 'forward', id: string, title: string, nested: Token[] }
  /**
   * A reply's quoted body. `nested` is what it said, drawn inside the quote block (a picture there
   * is still a picture); `text` is the same body flattened to one line, for the rare body that has
   * nothing to draw.
   */
  | { kind: 'quote', text: string, nested: Token[] }

const BY_ID = /^\[(图片|表情)\s#(\d+)\]$/
const BY_INDEX = /^\[(图片|表情)#(\d+)\]$/
const PLACEHOLDER = /\[(图片|表情|文件|视频|语音)\s?#\d+(?:\s[^\]]*)?\]/g

export function splitMessage(text: string): Token[] {
  const source = String(text ?? '')
  const own = ownQuote(source)
  const tokens = splitMarkup(own ? own.rest : source)
    .flatMap((part) => part.type === 'text' ? splitText(stripStrayTags(part.text)) : [blockToken(part)])
  if (!own) return tokens
  return [{ kind: 'quote', text: humanText(own.line, 200), nested: quoteBody(own.line) }, ...tokens]
}

/**
 * Our own quote line, at the top of a message. A markdown send on the official bot cannot carry QQ's
 * native quote (QQ then draws the body's plain-text rendition twice — see qq.ts), so the quote goes
 * into the body itself as a markdown blockquote: `> 名字：被引用的那句话`, blank line, the answer.
 * The panel draws it as the quote it is; as literal text it used to be a stray `> 名字：` with the
 * quoted message's markup (`<forward id="1" title="…" c…`) printed straight after it.
 */
function ownQuote(source: string): { line: string, rest: string } | undefined {
  if (!source.startsWith('>')) return undefined
  const end = source.indexOf('\n')
  const line = (end < 0 ? source : source.slice(0, end)).replace(/^>[ \t]?/, '')
  if (!line.trim()) return undefined
  return { line, rest: end < 0 ? '' : source.slice(end + 1).replace(/^\n+/, '') }
}

function blockToken(part: Extract<MarkupPart, { type: 'block' }>): Token {
  if (part.tag === 'quote') {
    // a quoted body is other people's words: no markup of its own to honour, just show them —
    // as tokens, so an attachment inside the quote still becomes a picture and not the literal
    // `[图片 #39]` it used to print, and a merged forward inside one is the one-line label
    // Message.tsx draws for it instead of a screenful of somebody else's chat log
    return { kind: 'quote', text: humanText(part.body, 200), nested: quoteBody(part.body) }
  }
  return { kind: 'forward', id: part.attrs.id ?? '1', title: part.attrs.title ?? '聊天记录', nested: splitMessage(part.body) }
}

/** Tokens of a quote body, with the tag debris truncation leaves behind taken off the text runs. */
function quoteBody(body: string): Token[] {
  return splitMessage(body).map((token) => {
    // `[图片#1]` counts the quoted message's own attachments, which we do not have here
    if (token.kind === 'text') return { kind: 'text', text: stripStrayTags(token.text) }
    // a nested quote is drawn as its text (see Message.tsx), so it needs nothing under it
    if (token.kind === 'quote') return { kind: 'quote', text: token.text, nested: [] }
    return token
  })
}

/** One run of text, cut at every attachment placeholder. */
function splitText(text: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = match.index ?? 0
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    const token = match[0]
    const byId = BY_ID.exec(token)
    const byIndex = byId ? null : BY_INDEX.exec(token)
    if (byId) out.push({ kind: 'image', id: Number(byId[2]), sticker: byId[1] === '表情' })
    else if (byIndex) out.push({ kind: 'legacy', index: Number(byIndex[2]), sticker: byIndex[1] === '表情' })
    // `[文件 #13 log.zip]` and the rest have no preview: the label is the whole point of them
    else out.push({ kind: 'text', text: token })
    last = at + token.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}
