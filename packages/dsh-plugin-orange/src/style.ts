/**
 * The send-time style step, as pure functions: which sub-styles this message
 * draws, and whether the rewritten sentence is safe to put in the group.
 * Kept import-free so the offline harness (`vm/debug/style-test.ts`) can exercise
 * it without a bot, a database or a network.
 */

/**
 * Draw `min`..`max` distinct sub-styles in random order (clamped to the pool).
 * `rnd` is injectable so the tests are deterministic.
 */
export function pickSubStyles(subs: string[], min: number, max: number, rnd: () => number = Math.random): string[] {
  const pool = [...new Set((subs ?? []).map((s) => String(s).trim()).filter(Boolean))]
  if (!pool.length) return []
  const lo = count(min)
  const hi = Math.max(lo, count(max))
  const draw = Math.min(hi, lo + Math.floor(rnd() * (hi - lo + 1)))
  const out: string[] = []
  for (let i = 0; i < draw && pool.length; i++) out.push(...pool.splice(Math.floor(rnd() * pool.length), 1))
  return out
}

function count(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

/**
 * The rewrite has to survive these guards before it replaces what the agent
 * wrote: a polished sentence is never worth a wrong one. Anything that drops a
 * link, an @, a version number or a markdown target, balloons in length, grows
 * an extra paragraph or comes back empty is thrown away, and the caller sends
 * the original text instead.
 */
export function acceptStyled(raw: string, original: string, maxChars: number): string | undefined {
  let out = String(raw ?? '').trim()
  if (!out) return undefined
  // fenced block, then a "改写：" style label the model sometimes prefixes
  out = out.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim()
  out = out.replace(/^(?:输出|改写|润色|重写|结果|回答)\s*[:：]\s*/, '').trim()
  out = unwrapQuotes(out)
  if (!out) return undefined
  if (out.length > maxChars) return undefined
  // a rewrite twice the size (or 12 chars longer) is padding, not styling
  if (out.length > Math.max(original.length * 2, original.length + 12)) return undefined
  // the model must not turn one message into a paragraph of its own: a one-line
  // sentence stays one line (the style uses spaces, not line breaks, to split)
  if (out.split('\n').length > Math.max(1, original.split('\n').length)) return undefined
  for (const url of original.match(/https?:\/\/[^\s，。）】]+/g) ?? []) if (!out.includes(url)) return undefined
  for (const m of original.matchAll(/\]\(([^)]+)\)/g)) if (!out.includes(m[1])) return undefined
  // an @ (a person, an id, an address) is not something a rewrite may drop
  for (const at of original.match(/@[^\s，。！？、,.!?]{2,}/g) ?? []) if (!out.includes(at)) return undefined
  for (const token of original.match(/\d[\d.\-:/]*/g) ?? []) {
    const number = token.replace(/[.\-:/]+$/, '')
    if (number.length >= 2 && !out.includes(number)) return undefined
  }
  return out
}

/** Straight/typographic quotes around the whole answer are decoration, not content. */
function unwrapQuotes(text: string): string {
  for (const [open, close] of [['"', '"'], ["'", "'"], ['“', '”'], ['「', '」']] as const) {
    if (!text.startsWith(open) || !text.endsWith(close) || text.length <= open.length + close.length) continue
    const inner = text.slice(open.length, text.length - close.length)
    // 「」 is a quoting device the main style allows: only unwrap a lone outer pair
    if (open === '「' && inner.includes('「')) continue
    return inner.trim()
  }
  return text
}
