/**
 * Attachment addressing. Every image/file the bot may look at gets **one stable id**, printed
 * right where it appears — `[图片 #12]`, `[文件 #13 log.zip]` — instead of a position inside a
 * particular message or merged-forward bundle. The model then asks for that id (`view_image`)
 * and never has to know whether the picture sat in the message, in its quote, in a nested
 * forward, or on which of the two platforms we saw it (see mediaId/resolveMedia in bot.ts).
 *
 * This module is the pure part: the label, and the parser for the merged-forward text the QQ
 * official bot hands over. That platform never gives us a forward as data — it renders the whole
 * bundle into one text element:
 *
 *     [群聊的聊天记录]
 *     === 消息 1 ===
 *     [消息内容] 你看看这个
 *     [发送者] 张三
 *     [附件1] 类型:图片 文件名:D293….png 尺寸:1430x748 大小:57.7KB URL:https://…
 *     --- 第1条 ---
 *         [发送者] 李四
 *
 * A block marked `[消息类型] 合并转发消息` is a bundle *inside* the bundle, and its entries are
 * the `--- 第K条 ---` blocks that follow, indented one more level (`    --- 第K条 ---` is a child
 * of the child). Parsing it back gives the same item/part tree crossgram returns for the userbot
 * side, so everything downstream (preview, get_forward, attachment ids) works the same on both.
 */

/** What the model reads in place of an attachment. */
export function mediaTag(id: number, kind: string, name?: string): string {
  const label = LABEL[kind] ?? '附件'
  return name && kind !== 'image' ? `[${label} #${id} ${name}]` : `[${label} #${id}]`
}

const LABEL: Record<string, string> = { image: '图片', video: '视频', audio: '音频', file: '文件', sticker: '表情' }

/**
 * What goes into the stored text where a merged forward sat: `[合并转发#1 群聊的聊天记录：张三: 你看看这个]`.
 * The preview is only what is read inline for the moment before `enrichText` replaces this with the
 * rendered `<forward>` block, and the fallback when that fails — so it carries the first line.
 * Brackets are stripped: the placeholder is found again by matching up to the next `]`.
 */
export function forwardPlaceholder(index: number, title: string, preview?: string): string {
  const clean = String(preview ?? '').replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim().slice(0, 80)
  return `[合并转发#${index} ${title}${clean ? '：' + clean : ''}]`
}

/** The first line of a parsed bundle, for that placeholder. */
export function bundlePreview(items: BundleItem[]): string {
  const first = items[0]
  if (!first) return ''
  return `${first.senderName}: ${first.parts.map((p: any) => p.type === 'text' ? p.text
    : p.type === 'media' ? (p.kind === 'image' ? '[图片]' : `[文件 ${p.name ?? ''}]`)
      : p.type === 'forward' ? `[转发 ${p.title ?? ''}]` : '').join('')}`
}

/** A media part inside a bundle: crossgram's shape, or the dump parser's. */
export interface BundleMedia {
  type: 'media'
  kind: string
  url?: string
  name?: string
  mime?: string
  /** crossgram spells it mimeType */
  mimeType?: string
  size?: number
  width?: number
  height?: number
}

/** A bundle nested inside another one. `locator` (crossgram) or `snapshot` (official dump). */
export interface BundleForward {
  type: 'forward'
  id?: string
  title?: string
  preview?: string
  locator?: unknown
  snapshot?: BundleItem[]
}

export type BundlePart = BundleMedia | BundleForward | { type: string, [key: string]: any }

/** One message inside a merged-forward bundle. */
export interface BundleItem { senderName: string, parts: BundlePart[] }

/** Is this the official-side rendering of a merged forward? */
export function isForwardDump(text: string): boolean {
  return parseForwardDump(text) !== undefined
}

/**
 * Parse the QQ-official merged-forward rendering back into items. Returns undefined when the text
 * is not one — the first line has to be the bundle title in brackets (`[群聊的聊天记录]`), which is
 * also what keeps an ordinary message, or a *quote* rendered the same way, out (a quote has no such
 * title line; see the flattened `[消息类型] 引用消息` form).
 */
export function parseForwardDump(text: string): { title: string, items: BundleItem[] } | undefined {
  const raw = String(text ?? '')
  if (!raw.includes('=== 消息 1 ===')) return undefined
  const lines = raw.split('\n')
  const head = lines[0]?.trim() ?? ''
  const title = head.match(/^\[(.+)\]$/)?.[1]
  if (!title) return undefined
  const items: BundleItem[] = []
  /** Most recent item per nesting level; level 0 is the bundle itself. */
  const byLevel: BundleItem[] = []
  /** Items the platform marked as a bundle: only those take `--- 第K条 ---` blocks as their children. */
  const bundles = new Set<BundleItem>()
  /**
   * An item that carries a bundle has QQ's own placeholder as its body — `[消息内容] [蔚敏电阻的聊天记录]`
   * — which is where that bundle's title comes from (the entries that follow carry no title of their own).
   */
  const placeholder = new Map<BundleItem, string>()
  /**
   * A `--- 第K条 ---` block under `[消息类型] 引用消息` is not a bundle but the message that was
   * replied to, so it is folded back into its item as a `<quote>` prefix (the same shape the rest of
   * the bot uses for a reply) once the whole dump has been read.
   */
  const quoted = new Map<BundleItem, BundleItem>()
  let current: BundleItem | undefined
  for (const line of lines.slice(1)) {
    const indent = line.length - line.trimStart().length
    const text = line.trim()
    if (!text) continue
    const top = text.match(/^=== 消息 \d+ ===\s*(.*)$/)
    if (top) {
      current = { senderName: '', parts: [] }
      items.push(current)
      byLevel.length = 0
      byLevel[0] = current
      if (top[1].trim()) push(current, top[1].trim())
      continue
    }
    const child = text.match(/^--- 第\d+条 ---\s*(.*)$/)
    if (child) {
      const level = Math.floor(indent / 4) + 1
      const parent = byLevel[level - 1]
      current = { senderName: '', parts: [] }
      if (parent && bundles.has(parent)) {
        const bundle = bundleOf(parent)
        if (!bundle.title) bundle.title = placeholder.get(parent) ?? ''
        bundle.snapshot = [...(bundle.snapshot ?? []), current]
      } else if (parent) {
        quoted.set(parent, current)
      } else {
        items.push(current)
        byLevel.length = 0
        byLevel[0] = current
      }
      byLevel[level] = current
      byLevel.length = level + 1
      if (child[1].trim()) push(current, child[1].trim())
      continue
    }
    if (!current) continue
    const sender = text.match(/^\[发送者\]\s*(.*)$/)
    if (sender) { current.senderName = sender[1].trim(); continue }
    const body = text.match(/^\[消息内容\]\s*(.*)$/)
    if (body) { push(current, body[1].trim()); continue }
    const type = text.match(/^\[消息类型\]\s*(.*)$/)
    if (type) { if (type[1].includes('合并转发')) bundles.add(current); continue }
    if (text.startsWith('[关联消息]')) { continue }
    const attachment = text.match(/^\[附件\d+\]\s*(.*)$/)
    if (attachment) {
      const part = attachmentOf(attachment[1])
      if (part) current.parts.push(part)
      continue
    }
    push(current, text)
  }
  for (const [item, quote] of quoted) {
    const body = quote.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ').trim()
    const label = quote.senderName ? `${quote.senderName}：` : ''
    if (body || label) item.parts.unshift({ type: 'text', text: `<quote>${label}${body || '[图片]'}</quote> ` })
    item.parts.push(...quote.parts.filter((p: any) => p.type !== 'text'))
  }
  return items.length ? { title, items } : undefined

  /** A text part, except a placeholder for a nested bundle, which becomes that bundle's title. */
  function push(item: BundleItem, text: string) {
    if (!text) return
    const nested = text.match(/^\[(.+(?:聊天记录|合并转发))\]$/)
    if (nested) { placeholder.set(item, nested[1]); return }
    const last = item.parts[item.parts.length - 1]
    if (last?.type === 'text') last.text = `${last.text} ${text}`
    else item.parts.push({ type: 'text', text })
  }

  /** The nested bundle a `[消息类型] 合并转发消息` item carries, created on first need. */
  function bundleOf(item: BundleItem): BundleForward {
    const existing = item.parts.find((p) => p.type === 'forward') as BundleForward | undefined
    if (existing) return existing
    const created: BundleForward = { type: 'forward', title: '', snapshot: [] }
    item.parts.push(created)
    return created
  }
}

/** `类型:图片 文件名:x.png 尺寸:1430x748 大小:57.7KB URL:https://…` -> a media part. */
function attachmentOf(fields: string): BundleMedia | undefined {
  const type = fields.match(/类型:(\S+)/)?.[1]
  if (!type) return undefined
  const kind = type.includes('视频') || type.includes('video') ? 'video'
    : type.includes('音频') || type.includes('audio') ? 'audio'
      : type.includes('文件') ? 'file' : 'image'
  const size = fields.match(/尺寸:(\d+)x(\d+)/)
  const bytes = fields.match(/大小:([\d.]+)\s*(KB|MB|B)/i)
  const part: BundleMedia = { type: 'media', kind }
  const name = fields.match(/文件名:(\S+)/)?.[1]
  if (name) part.name = name
  if (size) { part.width = Number(size[1]); part.height = Number(size[2]) }
  if (bytes) {
    const scale = bytes[2].toUpperCase() === 'MB' ? 1024 * 1024 : bytes[2].toUpperCase() === 'KB' ? 1024 : 1
    part.size = Math.round(Number(bytes[1]) * scale)
  }
  const url = fields.match(/URL:(\S+)/)?.[1]
  if (url) part.url = url
  return part
}
