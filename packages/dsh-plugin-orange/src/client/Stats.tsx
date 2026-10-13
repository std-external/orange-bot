/** Token / cost accounting. */
import { useEffect, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { CalendarDays, Coins, MessageCircle, Timer } from 'lucide-react'
import { api, convName, fmtTime, num, usd } from './api.ts'
import { Chips, Header, usePanel } from './ui.tsx'
import css from './pages.module.css'

const KIND: Record<string, string> = { classifier: '分类器', chat: '聊天 agent', task: '后台任务', 'chat-subagent': '聊天子 agent', 'task-subagent': '任务子 agent', style: '风格润色' }
const RANGES = [['1', '1 小时'], ['24', '24 小时'], ['72', '3 天'], ['168', '7 天'], ['720', '30 天']] as const
const sum = (rows: any[] = [], k = 'cost') => rows.reduce((a, r) => a + (r[k] ?? 0), 0)

export function Stats() {
  const { tick, go, byKey } = usePanel()
  const [hours, setHours] = useState('24')
  const [s, setS] = useState<any>()
  useEffect(() => { void api(`/stats?hours=${hours}`).then(setS).catch(() => {}) }, [tick, hours])
  const max = Math.max(1e-9, ...(s?.hourly ?? []).map((h: any) => h.cost ?? 0))
  return (
    <>
      <Header title="用量" sub="DeepSeek V4 Flash 高峰价估算：输入 $0.3 / 缓存 $0.006 / 输出 $1.2 每百万 token，非高峰减半">
        <Chips value={hours} options={RANGES} onChange={setHours} />
      </Header>
      {s && <div className={css.page}>
        <div className={css.stats}>
          <div className={css.card}><div className={css.statLabel}><Coins size={14} />区间花费</div><div className={css.statValue}>{usd(sum(s.byKind))}</div><div className={css.statSub}>{sum(s.byKind, 'calls')} 次调用</div></div>
          <div className={css.card}><div className={css.statLabel}><Timer size={14} />近 24 小时</div><div className={css.statValue}>{usd(sum(s.day))}</div></div>
          <div className={css.card}><div className={css.statLabel}><CalendarDays size={14} />近 7 天</div><div className={css.statValue}>{usd(sum(s.week))}</div><div className={css.statSub}>≈ {usd(sum(s.week) / 7 * 30)} / 月</div></div>
          <div className={css.card}><div className={css.statLabel}><MessageCircle size={14} />收到 / 发出</div><div className={css.statValue}>{num(s.messages?.n ?? 0)} / {s.responses?.n ?? 0}</div><div className={css.statSub}>dry run {s.responses?.dry ?? 0}</div></div>
        </div>
        <section className={css.section}>
          <h4>每小时</h4>
          <div className={css.bars}>
            {s.hourly.map((h: any) => (
              <Tooltip key={h.hour} label={`${fmtTime(h.hour, true)} · ${usd(h.cost)} · ${h.calls} 次`} side="top" portal>
                <div className={css.bar} style={{ height: `${Math.max(2, (h.cost / max) * 100)}%` }} />
              </Tooltip>
            ))}
          </div>
          <div className={css.axis}><span>{s.hourly[0] && fmtTime(s.hourly[0].hour, true)}</span><span>{s.hourly.at(-1) && fmtTime(s.hourly.at(-1).hour, true)}</span></div>
        </section>
        <div className={css.grid2}>
          <section className={css.section}>
            <h4>按类型</h4>
            <table className={css.table}>
              <thead><tr><th>类型</th><th>调用</th><th>输入</th><th>缓存</th><th>输出</th><th className={css.right}>花费</th></tr></thead>
              <tbody>{s.byKind.map((r: any) => (
                <tr key={r.kind}><td>{KIND[r.kind] ?? r.kind}</td><td>{r.calls}</td><td>{num(r.input)}</td>
                  <td>{num(r.cached)} <span className={css.muted}>{Math.round(100 * r.cached / Math.max(1, r.input + r.cached))}%</span></td>
                  <td>{num(r.output)}</td><td className={css.right}><b>{usd(r.cost)}</b></td></tr>
              ))}</tbody>
            </table>
          </section>
          <section className={css.section}>
            <h4>按会话</h4>
            <table className={css.table}><tbody>{s.byConv.map((r: any) => (
              <tr key={r.conv ?? '-'} className={css.rowLink} onClick={() => r.conv && go({ tab: 'chats', conv: r.conv })}>
                <td>{r.conv ? convName(byKey.get(r.conv), r.conv) : '(无)'}</td><td className={css.muted}>{r.calls} 次</td><td className={css.right}><b>{usd(r.cost)}</b></td>
              </tr>
            ))}</tbody></table>
          </section>
        </div>
      </div>}
    </>
  )
}
