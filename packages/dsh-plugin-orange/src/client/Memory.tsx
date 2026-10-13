/** Long-term memory, cross-group events, user tags. */
import { useEffect, useState } from 'react'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { Search, Trash2 } from 'lucide-react'
import { api, fmtTime } from './api.ts'
import { Avatar, Badge, ConvLink, Empty, Header, usePanel } from './ui.tsx'
import css from './pages.module.css'

export function Memory() {
  const { tick, go } = usePanel()
  const [data, setData] = useState<any>({ memory: [], users: [], events: [] })
  const [q, setQ] = useState('')
  const load = () => { void api('/memory').then(setData).catch(() => {}) }
  useEffect(load, [tick])
  const users = data.users.filter((u: any) => !q || (u.name + u.key).toLowerCase().includes(q.toLowerCase())).slice(0, 200)
  return (
    <>
      <Header title="记忆与用户" sub="agent 的长期记忆、分类器记下的跨群事件、用户的开发者标签" />
      <div className={`${css.page} ${css.grid2}`}>
        <div>
          <section className={css.section}>
            <h4>长期记忆 · {data.memory.length}</h4>
            <div className={css.feed}>
              {data.memory.map((m: any) => (
                <div key={m.id} className={css.card}>
                  <div className={css.top}><Badge>{m.scope}</Badge><span>{fmtTime(m.ts, true)}</span><span className={css.grow} />
                    <Trash2 size={13} style={{ cursor: 'pointer' }} onClick={async () => { await api('/memory/delete', { id: m.id }); load() }} /></div>
                  <div className={css.body}>{m.text}</div>
                </div>
              ))}
              {!data.memory.length && <Empty text="还没有记忆" />}
            </div>
          </section>
          <section className={css.section}>
            <h4>跨群事件</h4>
            <div className={css.feed}>
              {data.events.slice().reverse().map((e: any, i: number) => (
                <div key={i} className={`${css.card} ${css.clickable}`} onClick={() => go({ tab: 'chats', conv: e.conv })}>
                  <div className={css.top}><ConvLink conv={e.conv} /><span>{fmtTime(e.ts, true)}</span></div>
                  <div className={css.body}>{e.text}</div>
                </div>
              ))}
              {!data.events.length && <Empty text="暂无" />}
            </div>
          </section>
        </div>
        <section className={css.section}>
          <h4>用户标签</h4>
          <Input icon={<Search size={14} />} placeholder="搜索用户" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
          <table className={css.table} style={{ marginTop: 8 }}><tbody>
            {users.map((u: any) => (
              <tr key={u.key}>
                <td style={{ width: 40 }}><Avatar src={u.avatar} name={u.name} seed={u.key} size={28} /></td>
                <td>{u.name}<div className={css.muted}>{u.key}</div></td>
                <td className={css.right}><span className={css.muted} style={{ marginRight: 8 }}>开发者</span>
                  <Switch label="开发者" checked={u.tags.includes('dev')} onChange={async (v) => { await api('/user-tag', { user: u.key, tag: 'dev', on: v }); load() }} /></td>
              </tr>
            ))}
          </tbody></table>
        </section>
      </div>
    </>
  )
}
