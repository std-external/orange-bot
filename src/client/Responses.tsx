/** Everything the bot said (or chose not to), with its trigger and a jump to context. */
import { useEffect, useState } from 'react'
import { Send, X } from 'lucide-react'
import { api, convName, fmtTime } from './api.ts'
import { Avatar, Badge, Chips, ConvLink, Empty, Header, SessionLink, usePanel } from './ui.tsx'
import css from './pages.module.css'

export const TRIGGER: Record<string, string> = { command: '/ai', mention: '@', reply: '回复', direct: '私聊', classifier: '旁听', task: '任务', no_reply: '不回复', react: '表情', admin: '管理', manual: '面板', error: '错误', agent: 'agent', auto: '自动表情', screened: '审查' }
const FILTERS = [['', '全部'], ['command', '/ai'], ['mention', '@'], ['classifier', '旁听'], ['task', '任务'], ['auto', '自动表情'], ['no_reply', '不回复'], ['screened', '审查'], ['error', '错误']] as const
/** Dry run is a separate axis: any trigger can be a dry run, so it gets its own chips. */
const DRY = [['', '不限 dry'], ['1', '只看 dry run'], ['0', '排除 dry run']] as const

export function Responses() {
  const { tick, route, go, byKey } = usePanel()
  const [rows, setRows] = useState<any[]>([])
  const [trigger, setTrigger] = useState('')
  const [dry, setDry] = useState('')
  const conv = route.conv
  useEffect(() => {
    const qs = new URLSearchParams({ ...(conv ? { conv } : {}), ...(trigger ? { trigger } : {}), ...(dry ? { dry } : {}) })
    void api(`/responses?${qs}`).then(setRows).catch(() => {})
  }, [tick, conv, trigger, dry])
  return (
    <>
      <Header title={<>响应记录{conv && <Badge tone="info">{convName(byKey.get(conv), conv)}<X size={11} style={{ cursor: 'pointer' }} onClick={() => go({ tab: 'responses', conv: undefined })} /></Badge>}</>} sub="点击一条跳到聊天里对应的位置">
        <Chips value={trigger} options={FILTERS} onChange={setTrigger} />
        <span className={css.divider} />
        <Chips value={dry} options={DRY} onChange={setDry} />
      </Header>
      <div className={css.page}>
        <div className={`${css.feed} ${css.narrow}`}>
          {rows.map((r) => {
            const c = byKey.get(r.conv)
            const seq = r.trigger_message?.seq
            return (
              <div key={r.id} className={`${css.card} ${css.clickable}`} onClick={() => go({ tab: 'chats', conv: r.conv, seq })}>
                <div className={css.top}>
                  <Avatar src={c?.avatar} name={convName(c, r.conv)} seed={r.conv} size={18} square />
                  <ConvLink conv={r.conv} seq={seq} />
                  <span>{fmtTime(r.ts, true)}</span>
                  <Badge>{TRIGGER[r.trigger] ?? r.trigger}</Badge>
                  {r.dry_run ? <Badge tone="warn">dry run</Badge> : r.error ? <Badge tone="err">失败</Badge> : r.delivered ? <Badge tone="ok">已发送</Badge> : null}
                  <span className={css.grow} />
                  <SessionLink id={r.session_id} />
                </div>
                {r.trigger_message && r.trigger !== 'task' && <div className={css.ctx}><span className={css.strong}>{r.trigger_message.sender_name}</span>{r.trigger_message.text}</div>}
                <div className={css.body}>{String(r.text).replace(/^\(no_reply\)\s*/, '')}</div>
                {r.context && <div className={css.muted}>{r.context}</div>}
                {r.error && <div className={css.body} style={{ color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 }}>{r.error}</div>}
              </div>
            )
          })}
          {!rows.length && <Empty icon={<Send size={28} strokeWidth={1.25} />} text="没有符合条件的记录" />}
        </div>
      </div>
    </>
  )
}
