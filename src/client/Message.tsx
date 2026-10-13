/** Message bubble, inline bot events, day separators. */
import { useMemo, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { AlertTriangle, BellRing, FlaskConical, Link2, MessageSquareOff, Reply, ThumbsUp } from 'lucide-react'
import { fmtTime, type Msg } from './api.ts'
import { humanText } from '../markup.ts'
import { Avatar, SessionLink, usePanel } from './ui.tsx'
import { splitMessage, type Token } from './tokens.ts'
import css from './Message.module.css'

/**
 * The body of a bubble: plain runs, attachment thumbnails, and merged-forward cards — a forward's
 * own body is drawn with the same function, so a *nested* forward becomes a card inside a card
 * instead of the outer one being cut at the inner `</forward>` (see tokens.ts / markup.ts).
 */
function Body({ m }: { m: Msg }) {
  const { zoom } = usePanel()
  const media = useMemo(() => { try { return JSON.parse(m.raw || '{}').media ?? [] } catch { return [] } }, [m.raw])
  /** Where these tokens sit: in a forward card, or inside an inline quote (which draws compactly). */
  const draw = (tokens: Token[], where: { forward?: boolean, quote?: boolean } = {}): ReactNode[] => tokens.map((token, i) => {
    switch (token.kind) {
      case 'text':
        return token.text ? <span key={i}>{token.text}</span> : null
      case 'image': {
        const src = `./orange-api/media?id=${token.id}`
        return <img key={i} className={where.quote ? css.quoteImage : token.sticker ? css.sticker : css.image} src={src} loading="lazy" onClick={() => zoom(src)} />
      }
      case 'legacy': {
        // `[图片#1]` counts the *message's* attachments; inside a forward or a quote that number
        // belongs to the bundle/quoted message instead and has no address of its own, so it stays text
        if (where.forward || where.quote || !media[token.index - 1]) return <span key={i}>{`[${token.sticker ? '表情' : '图片'}#${token.index}]`}</span>
        const src = `./orange-api/media?seq=${m.seq}&index=${token.index}`
        return <img key={i} className={token.sticker ? css.sticker : css.image} src={src} loading="lazy" onClick={() => zoom(src)} />
      }
      case 'quote': {
        // a reply's quoted body (QQ: recovered from the event, see renderQuote in satori.ts)
        // ... and, inside a quote, what that one said: one more block inside a block is noise
        if (where.quote) return <span key={i}>{token.text || '引用了一条消息'}</span>
        const visible = token.nested.some((t) => t.kind !== 'text' || !!t.text.trim())
        return <div key={i} className={css.inlineQuote}>{visible ? draw(token.nested, { quote: true }) : (token.text || '引用了一条消息')}</div>
      }
      case 'forward':
        // inside a quote a chat log is just its title: a card inside a quote block is a lot of
        // somebody else's conversation in the middle of a reply preview
        if (where.quote) return <span key={i} className={css.quoteForward} data-forward={token.id}>{`[${token.title}]`}</span>
        // `data-forward` is the stable hook for tests/scripts: css-module class names are minified
        return (
          <div key={i} className={css.forward} data-forward={token.id}>
            <div className={css.forwardTitle}>{token.title}{token.id === '1' ? '' : `（${token.id}）`}</div>
            {draw(token.nested, { forward: true })}
          </div>
        )
      default:
        return null
    }
  })
  return <>{draw(splitMessage(m.text))}</>
}

/**
 * The one line on the reply row. Stored text is written for the model — `<quote>…</quote>`,
 * `<forward …>…</forward>`, `[图片 #12]` — and used to be pasted here verbatim, so a reply to a
 * merged forward showed `<forward id="1" title="群聊的聊天记录" count="6">` as raw XML. See
 * humanText in markup.ts for what replaces it.
 */
function quoteLabel(m: Msg): string {
  const text = humanText(m.text, 90)
  if (!text) return '引用了一条更早的消息'
  const name = m.fromBot ? '橘波特' : (m.senderName ?? '').trim()
  return name ? `${name}：${text}` : text
}

export function Message({ m, cont, quoted, avatar, role }: { m: Msg, cont: boolean, quoted?: Msg, avatar?: string, role?: string }) {
  const { go, toast } = usePanel()
  const side = m.fromBot ? css.bot : m.self ? css.me : ''
  const name = m.fromBot ? '橘波特' : m.senderName
  // Identity badges, same three roles the agent sees: 主人 / 群主 / 群管.
  const roleLabel = role === 'bot' ? '机器人管理员' : role === 'owner' ? '群主' : role === 'administrator' ? '群管' : ''
  const roleClass = role === 'bot' ? css.roleBot : role === 'owner' ? css.roleOwner : css.roleAdmin
  const copy = () => { void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#orange/chats/${encodeURIComponent(m.conv)}/${m.seq}`); toast('已复制消息链接') }
  return (
    <div className={`${css.row} ${side} ${cont ? css.cont : ''}`} data-seq={m.seq}>
      <span className={css.avatarCol}>{!cont && (m.fromBot ? <span className={css.botAvatar}>🍊</span> : <Avatar src={avatar} name={name} seed={m.senderId} size={34} />)}</span>
      <div className={css.col}>
        {!cont && <div className={css.meta}>
          <span className={css.name}>{name}</span>
          {roleLabel && <span className={`${css.role} ${roleClass}`}>{roleLabel}</span>}
          <span>{fmtTime(m.ts)}</span>
          {m.mentionsSelf && <span className={css.at}>@bot</span>}
        </div>}
        <div className={css.bubbleRow}>
          <div className={css.bubble}>
            {m.replyTo && (
              <button className={css.quote} disabled={!quoted} onClick={() => quoted && go({ tab: 'chats', conv: m.conv, seq: quoted.seq })}>
                <Reply size={12} />{quoted ? quoteLabel(quoted) : '引用了一条更早的消息'}
              </button>
            )}
            <Body m={m} />
          </div>
          <Tooltip label={`#${m.seq} · ${fmtTime(m.ts, true)} · 复制链接`} side="top" portal>
            <button className={css.permalink} onClick={copy}><Link2 size={12} /></button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

const EVENTS: Record<string, { Icon: typeof BellRing, cls: string, label: (v: any) => string }> = {
  wake: { Icon: BellRing, cls: 'wake', label: (v) => `分类器唤醒 · ${v.reason}` },
  dry: { Icon: FlaskConical, cls: 'dry', label: (v) => `dry run 未发送：${v.text}` },
  err: { Icon: AlertTriangle, cls: 'err', label: (v) => `发送失败：${v.error}` },
  noreply: { Icon: MessageSquareOff, cls: '', label: (v) => `决定不回复 · ${String(v.text).replace(/^\(no_reply\)\s*/, '')}` },
  react: { Icon: ThumbsUp, cls: '', label: () => '贴了个表情' },
}

export function EventLine({ kind, v }: { kind: string, v: any }) {
  const e = EVENTS[kind]
  if (!e) return null
  return (
    <div className={`${css.event} ${e.cls ? css[e.cls] : ''}`}>
      <span className={css.eventPill}><e.Icon size={13} /><span className={css.eventText}>{e.label(v)}</span><SessionLink id={v.session_id} label="上下文" /></span>
    </div>
  )
}

export function DayLine({ ts }: { ts: number }) {
  return <div className={css.day}><span>{new Date(ts).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span></div>
}
