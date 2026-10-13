/**
 * QQ official-bot outbound quirks the platform forces on us.
 *
 * A markdown message that also carries a quote (`message_reference`, which is
 * what an outbound `quote` part turns into) is expanded by QQ into
 * `[markdown, plain text, plain text]`: the body's plain-text rendition is
 * attached *twice* instead of once. A client that draws that rendition then
 * shows the sentence twice inside one bubble — the "一个气泡正文叠两遍" report
 * from 2026-10-10.
 *
 * Measured against the live OpenAPI, one field at a time with everything else
 * held constant: markdown + message_reference → 3 parts, markdown alone → 2,
 * plain text + message_reference → 1, plain text alone → 1. Neither an explicit
 * `content`, an empty `content`, a `stream` object, a real `REFIDX_…` reference
 * (instead of the raw message id), passive vs. active, nor group vs. C2C changed
 * anything: the quote on a markdown message is the only trigger.
 *
 * So markdown wins and the quote is dropped. Losing QQ's reply UI on those
 * messages beats showing every sentence twice on the clients that render the
 * fallback rendition.
 */
import { humanText } from './markup.ts'

export function markdownDropsQuote<T extends { type: string }>(parts: T[]): T[] {
  if (!parts.some((part) => part.type === 'markdown')) return parts
  const kept = parts.filter((part) => part.type !== 'quote')
  return kept.length === parts.length ? parts : kept
}

/**
 * QQ's own in-message @ markup. The platform documents `<qqbot-at-user id="" />` as the current
 * form for 群聊 and 文字子频道, with `<@userid>` as the deprecated one — and a Satori `at` element
 * never becomes either: the group encoder of `@satorijs/adapter-qq@4.14.0` has no `at` branch at
 * all (`QQMessageEncoder.visit` walks text/quote/img/…, so an `at` element falls into the
 * `render(children)` default with no children and vanishes). Everything the plugin ever @-ed with
 * a plain `at` element was therefore dropped silently.
 *
 * Two more things are measured, not guessed (`vm/debug/at-wire-probe.cjs` against the real adapter,
 * and two labelled self-test sends in a live group for the platform's own parsing):
 *  - the markup is parsed only in a **markdown** message; in a plain-text one (msg_type 0) the
 *    group sees the literal `<qqbot-at-user id="…" />` string, so a mention forces markdown;
 *  - it has to sit *inside* the body that carries the text — for a markdown message that means
 *    inside the markdown body, because `ensureMarkdown()` rewrites (`escapeMarkdown`) whatever was
 *    accumulated before the first `<qq:markdown>` element, turning the markup into `\<qqbot\-at\-user`.
 */
export function atMarkup(userId: string): string {
  return `<qqbot-at-user id="${String(userId ?? '').replace(/["<>]/g, '')}" />`
}

const AT_MARKUP = /<qqbot-at-user\s+id="([^"]*)"\s*\/>/g

/** The same text with QQ's @ markup written out as a person sees it (`@名字`). */
export function humanizeAtMarkup(text: unknown, label: (id: string) => string): string {
  return String(text ?? '').replace(AT_MARKUP, (_match, id: string) => `@${label(id)}`)
}

/**
 * Fold every `at` element into the text it belongs to, as QQ's markup. The adapter drops an `at`
 * element (see atMarkup), so a mention travels as text — and it has to travel inside the body:
 * with the run that follows it when there is one, at the end of the last body run when the
 * mention came last, and as a body of its own (which the encoder flushes as its own message
 * before any media) when the message carries no text at all.
 *
 * The run that receives the markup is promoted to `markdown`, even if it was plain text: QQ parses
 * the markup only in a markdown message, and a plain-text one (msg_type 0) reaches the group as
 * the literal `<qqbot-at-user …>` string — measured against the live group, see atMarkup.
 */
export function foldMentions<T extends { type: string, text?: string, userId?: string }>(parts: T[]): T[] {
  if (!parts.some((part) => part.type === 'at')) return parts
  const out: T[] = []
  let pending = ''
  let lastBody = -1
  for (const part of parts) {
    if (part.type === 'at') { pending += atMarkup(part.userId ?? ''); continue }
    if (part.type === 'text' || part.type === 'markdown') {
      out.push(pending ? { ...part, type: 'markdown', text: pending + (part.text ?? '') } as unknown as T : part)
      pending = ''
      lastBody = out.length - 1
      continue
    }
    out.push(part)
  }
  if (pending) {
    if (lastBody >= 0) out[lastBody] = { ...out[lastBody], type: 'markdown', text: `${out[lastBody].text ?? ''}${pending}` } as unknown as T
    else out.unshift({ type: 'markdown', text: pending } as unknown as T)
  }
  return out
}

/**
 * The markdown blockquote that stands in for QQ's native 引用回复 on messages
 * that go out as markdown: one line, `> 名字：被引用的那句话`, which every QQ
 * markdown renderer draws as a quoted block (the format is in the platform's
 * markdown docs). Used instead of a `quote` part on those sends, because the
 * native quote is exactly what triggers the doubled body above.
 *
 * The snippet is flattened to one line, stripped of markdown punctuation (it is
 * a preview — a stray `*` or `[` from the quoted message must not reach into the
 * body below it) and clipped, so a wall of text still leaves the answer readable.
 * It goes through `humanText` first: the quoted message is stored the way the
 * agent reads it (`<quote>…</quote>`, `<forward …>…</forward>`, `[图片 #12]`),
 * and pasting that into a message the group reads shipped raw XML to QQ — a reply
 * to a merged forward went out as `> 名字：<forward id="1" title="群聊的聊天记录" c…`.
 */
export function quoteBlockquote(quoted: { name?: string, text?: string }, maxChars = 42): string {
  const flatten = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
  const snippet = humanText(quoted.text).replace(/[\\`*_~[\]]/g, '')
  if (!snippet) return ''
  const name = flatten(quoted.name)
  const clipped = snippet.length > maxChars ? `${snippet.slice(0, maxChars)}…` : snippet
  return `> ${name ? `${name}：` : ''}${clipped}`
}
