/**
 * Cross-platform peer detection helpers.
 *
 * One physical QQ group is visible twice: the official bot sees it as an opaque
 * `group_openid`, the userbot (crossgram) as a group number. Linking the two views
 * cannot be done by id, so it is inferred from traffic — and traffic is a weak
 * signal: busy groups repeat short lines ("哈哈", "?", "看看"), both platforms
 * render an image as `[图片#1]`, and @-mentions/URLs render differently. Matching on
 * raw text therefore pairs random groups, which then wear each other's name, avatar
 * and settings. Only information-bearing text, from the same person, seconds apart
 * counts as evidence here; two independent pieces of evidence make a link.
 */
import { stripMarkup } from './markup.ts'

/** Minimum length of a normalized text before it is allowed to count as evidence. */
export const PAIR_MIN_CHARS = 8

/** Two views of the same message can be a few seconds apart, never minutes. */
export const PAIR_WINDOW_MS = 20_000

/** Independent matching messages required before two conversations are linked. */
export const PAIR_CONFIRM = 2

/**
 * Normalize a rendered message for cross-platform comparison: drop everything whose
 * rendering is platform-specific (quote/forward wrappers, mentions, media and card
 * placeholders, punctuation, whitespace) and keep the words people actually typed.
 *
 * The wrapper blocks are found by counting tags (`stripMarkup`), not with a regex: a merged forward
 * nests, and `/<forward[\s\S]*?<\/forward>/` stops at the inner `</forward>`, which used to leave
 * the tail of a nested bundle in the text being compared.
 */
export function pairText(text: string): string {
  return stripMarkup(String(text ?? ''))
    .replace(/<[^>\n]{1,60}>/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/\[[^\]\n]{0,80}\]/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[，。！？、~,.!?…—\-_*“”‘’'"()（）:：;；|]/g, '')
}

/** A sender name without platform decorations: "西红柿炒鸡蛋里的番茄 (CV1)" -> "西红柿炒鸡蛋里的番茄". */
export function plainName(name: string): string {
  return String(name ?? '')
    .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')
    .replace(/[\s·|]/g, '')
    .toLowerCase()
}

/** Whether both platforms are talking about the same person. */
export function senderMatch(a: string, b: string): boolean {
  const x = plainName(a)
  const y = plainName(b)
  if (!x || !y) return false
  if (x === y) return true
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))
}

/** Public QQ group avatar URL — the group number is the whole secret. */
export function groupAvatar(groupNumber: string): string {
  return `https://p.qlogo.cn/gh/${groupNumber}/${groupNumber}/640/`
}
