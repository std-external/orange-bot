/**
 * The 表情 manager.
 *
 * One page for the whole pool: filter it, edit one sticker in the drawer, act on
 * a selection in the batch bar, drag image files in, and pull the QQ account's
 * 收藏表情 through the bridge. Importing or re-classifying runs on the server
 * (three at a time) and reports progress as an SSE job, so the page never blocks
 * and a second tab sees the same progress bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { Check, Download, RefreshCw, Save, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { api, convName } from './api.ts'
import { Header, usePanel } from './ui.tsx'
import css from './Stickers.module.css'

type Sticker = {
  id: number, key: string, source: string, provider: string, refId: string, pack: string, title: string,
  desc: string, tags: string[], weight: number, enabled: boolean, format: string, mime: string,
  width: number, height: number, size: number, uses: number, lastUsed: number, created: number, error: string,
  reference: string,
}
type SType = { id: string, name: string, desc: string }
type Job = { id: string, kind: string, total: number, done: number, skipped: number, failed: number, running: boolean, cancelled: boolean, current: string, errors: string[] }
type Remote = { key: string, providerId: string, stickerId: string, title?: string, format?: string, mimeType?: string, url?: string, size?: number, imported: boolean }

const thumbUrl = (id: number) => `./orange-api/sticker/file?id=${id}&thumb=1`
const kB = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`

/** Progress of the running (or last finished) import/classify job. */
function JobBar({ job, onCancel }: { job: Job, onCancel: () => void }) {
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0
  const label = job.kind === 'import' ? '从 QQ 导入' : job.kind === 'upload' ? '导入文件' : '重新分类'
  return (
    <div className={css.job}>
      <div className={css.row} style={{ fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>{label}{job.running ? '中' : '完成'}</span>
        <span className={css.spacer} />
        <span className={css.tagPill}>{job.done}/{job.total}</span>
        {job.skipped > 0 && <span className={css.tagPill}>跳过 {job.skipped}</span>}
        {job.failed > 0 && <span className={css.tagPill}>失败 {job.failed}</span>}
        {job.running && <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={onCancel}>取消</Button>}
      </div>
      <div className={css.track}><div className={css.fill} style={{ width: `${pct}%` }} /></div>
      <div className={css.meta} style={{ gridTemplateColumns: '1fr' }}>
        <span>{job.running ? (job.current || '准备中…') : `结束于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`}</span>
        {job.errors.slice(0, 2).map((e, i) => <span key={i} className={css.err}>{e}</span>)}
      </div>
    </div>
  )
}

/** Pick remote 收藏表情 to import. Thumbnails come straight from the QQ CDN. */
function ImportDialog({ onClose, onJob, toast }: { onClose: () => void, onJob: (job: Job) => void, toast: (s: string) => void }) {
  const [remote, setRemote] = useState<{ stickers: Remote[], at: number, cached: boolean }>()
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string[]>([])
  const [classify, setClassify] = useState(true)
  const load = useCallback(async (refresh: boolean) => {
    setLoading(true)
    try { setRemote(await api(`/stickers/remote${refresh ? '?refresh=1' : ''}`)) } catch (e) { toast((e as Error).message) } finally { setLoading(false) }
  }, [toast])
  useEffect(() => { void load(false) }, [load])
  const stickers = remote?.stickers ?? []
  const fresh = stickers.filter((s) => !s.imported)
  const toggle = (key: string) => setSel((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])
  const start = async () => {
    try {
      const r = await api('/stickers/import', { keys: sel, classify })
      onJob(r.job)
      toast(`开始导入 ${r.job.total} 张`)
      onClose()
    } catch (e) { toast((e as Error).message) }
  }
  return (
    <div className={css.modalCenter} onClick={onClose}>
      <div className={css.importBox} onClick={(e) => e.stopPropagation()}>
        <div className={css.row}>
          <span className={css.drawerTitle}>从 QQ 收藏表情导入</span>
          <span className={css.tagPill}>{stickers.length} 张 · 未导入 {fresh.length}</span>
          {remote?.cached && <span className={css.tagPill}>用的缓存（10 分钟内）</span>}
          <span className={css.spacer} />
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} disabled={loading} onClick={() => void load(true)}>刷新列表</Button>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} />
        </div>
        <div className={css.row}>
          <Button size="sm" variant="outline" onClick={() => setSel(fresh.map((s) => s.key))}>全选未导入</Button>
          <Button size="sm" variant="outline" onClick={() => setSel(fresh.filter((s) => !sel.includes(s.key)).map((s) => s.key))}>反选</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel([])}>清空</Button>
          <span className={css.spacer} />
          <Switch label="导入时自动分类" checked={classify} onChange={setClassify} />
          <Button size="sm" variant="primary" icon={<Download size={14} />} disabled={!sel.length} onClick={start}>导入 {sel.length} 张</Button>
        </div>
        {loading && <div className={css.empty}>正在读 QQ 收藏表情…（列表要探测每张的尺寸，第一次大约 15 秒）</div>}
        <div className={css.importGrid}>
          {stickers.map((s) => (
            <div
              key={s.key}
              className={`${css.remote} ${sel.includes(s.key) ? css.remoteOn : ''} ${s.imported ? css.remoteDone : ''}`}
              title={s.imported ? '已经在表情库里了' : (s.title || s.stickerId)}
              onClick={() => { if (!s.imported) toggle(s.key) }}
            >
              {s.url ? <img src={s.url} loading="lazy" referrerPolicy="no-referrer" alt="" /> : <span className={css.tagPill}>no preview</span>}
              {sel.includes(s.key) && <span className={css.check} style={{ left: 'auto', right: 6 }}><Check size={12} /></span>}
              {s.imported && <span className={css.badge}>已有</span>}
            </div>
          ))}
        </div>
        <div className={css.meta} style={{ gridTemplateColumns: '1fr' }}>
          <span>导入是 3 并发；每张会用视觉模型写一句描述并打类型标签，可以随时取消。</span>
        </div>
      </div>
    </div>
  )
}

/** One sticker in full: preview, description, types, weight, and the actions. */
function Detail({ sticker, types, onClose, onSaved, onJob, toast }: { sticker: Sticker, types: SType[], onClose: () => void, onSaved: () => void, onJob: (job: Job) => void, toast: (s: string) => void }) {
  const { zoom, convs } = usePanel()
  const [desc, setDesc] = useState(sticker.desc)
  const [tags, setTags] = useState<string[]>(sticker.tags)
  const [weight, setWeight] = useState(sticker.weight)
  const [enabled, setEnabled] = useState(sticker.enabled)
  const [conv, setConv] = useState(convs[0]?.key ?? '')
  const [busy, setBusy] = useState('')
  useEffect(() => { setDesc(sticker.desc); setTags(sticker.tags); setWeight(sticker.weight); setEnabled(sticker.enabled) }, [sticker.id])
  const dirty = desc !== sticker.desc || weight !== sticker.weight || enabled !== sticker.enabled || tags.join() !== sticker.tags.join()
  const run = async (what: string, fn: () => Promise<any>) => {
    setBusy(what)
    try { await fn() } catch (e) { toast((e as Error).message) } finally { setBusy('') }
  }
  const save = () => run('save', async () => {
    await api('/sticker/update', { id: sticker.id, desc, tags, weight, enabled })
    toast('已保存')
    onSaved()
  })
  const reclassify = () => run('classify', async () => {
    const r = await api('/sticker/batch', { op: 'classify', ids: [sticker.id], force: true })
    if (r.job) onJob(r.job)
    toast('重新分类中…')
    onSaved()
  })
  const send = () => run('send', async () => {
    const r = await api('/stickers/test-send', { id: sticker.id, conv })
    toast(r.dryRun ? 'dry-run 会话：只记录没发出' : `已发到 ${convName(convs.find((c) => c.key === conv), conv)}`)
  })
  const remove = () => run('delete', async () => {
    await api('/sticker/batch', { op: 'delete', ids: [sticker.id] })
    toast('已删除')
    onClose()
    onSaved()
  })
  return (
    <div className={css.modal} onClick={onClose}>
      <div className={css.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={css.drawerHead}>
          <span className={css.drawerTitle}>表情 #{sticker.id}</span>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} />
        </div>
        <div className={css.preview} onClick={() => zoom(`./orange-api/sticker/file?id=${sticker.id}`)}>
          <img src={thumbUrl(sticker.id)} alt="" />
        </div>
        {sticker.error && <div className={css.err}>{sticker.error}</div>}
        <div className={css.field}>
          <span className={css.label}>描述（agent 选表情时看到的就是这句话）</span>
          <textarea className={css.textarea} rows={2} value={desc} placeholder="比如：捂脸苦笑，表示无语" onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className={css.field}>
          <span className={css.label}>类型（可以多选）</span>
          <div className={css.chips}>
            {types.map((t) => (
              <button key={t.id} title={t.desc} className={`${css.chip} ${tags.includes(t.id) ? css.chipOn : ''}`}
                onClick={() => setTags(tags.includes(t.id) ? tags.filter((x) => x !== t.id) : [...tags, t.id])}>{t.name}</button>
            ))}
          </div>
        </div>
        <div className={css.field}>
          <span className={css.label}>权重 {weight}（越高越容易被挑中）</span>
          <div className={css.row}>
            <input className={css.slider} type="range" min={0} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
            <input className={css.textarea} style={{ width: 64 }} type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
          </div>
        </div>
        <div className={css.row}>
          <Switch label="启用" checked={enabled} onChange={setEnabled} />
          <span className={css.spacer} />
          <Button size="sm" variant="ghost" icon={<Sparkles size={14} />} disabled={!!busy} onClick={reclassify}>{busy === 'classify' ? '分类中…' : '重新分类'}</Button>
        </div>
        <div className={css.meta}>
          <b>来源</b><span>{sticker.source === 'bridge' ? `QQ 收藏（${sticker.pack || '无分组'}）` : '上传'}</span>
          <b>原生表情</b><span>{sticker.reference ? '是（userbot 侧按真表情发）' : '否（按图片发）'}</span>
          <b>格式</b><span>{sticker.mime} {sticker.width}×{sticker.height} {kB(sticker.size)} {sticker.format === 'animated' ? '动图' : ''}</span>
          <b>用过</b><span>{sticker.uses} 次{sticker.lastUsed ? `（上次 ${new Date(sticker.lastUsed).toLocaleString('zh-CN', { hour12: false })}）` : ''}</span>
          <b>标识</b><span style={{ wordBreak: 'break-all' }}>{sticker.key}</span>
        </div>
        <div className={css.row}>
          <select className={css.textarea} style={{ flex: 1 }} value={conv} onChange={(e) => setConv(e.target.value)}>
            {convs.map((c) => <option key={c.key} value={c.key}>{convName(c, c.key)}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!conv || !!busy} onClick={send}>测试发送</Button>
        </div>
        <div className={css.row}>
          <Button size="sm" variant="primary" icon={<Save size={14} />} disabled={!dirty || !!busy} onClick={save}>保存修改</Button>
          <span className={css.spacer} />
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={!!busy} onClick={remove}>删除</Button>
        </div>
      </div>
    </div>
  )
}

export function Stickers() {
  const { toast, stickerTick, stickerJob } = usePanel()
  const [data, setData] = useState<{ stickers: Sticker[], types: SType[], tagCounts: Record<string, number>, stats: any }>()
  const [tags, setTags] = useState<string[]>([])
  const [untagged, setUntagged] = useState(false)
  const [query, setQuery] = useState('')
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [order, setOrder] = useState('weight')
  const [sel, setSel] = useState<number[]>([])
  const [detail, setDetail] = useState<number>()
  const [job, setJob] = useState<Job>()
  const [importing, setImporting] = useState(false)
  const [dropping, setDropping] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (tags.length) p.set('tags', tags.join(','))
    if (untagged) p.set('untagged', '1')
    if (query.trim()) p.set('query', query.trim())
    if (enabledOnly) p.set('enabled', '1')
    p.set('order', order)
    return p.toString()
  }, [tags, untagged, query, enabledOnly, order])

  const load = useCallback(() => { void api(`/stickers?${qs}`).then(setData).catch(() => {}) }, [qs])
  // SSE pushes one event per imported sticker; the list is only re-read once the
  // burst settles, so a 263-sticker import does not re-render 263 times.
  useEffect(() => {
    const timer = setTimeout(load, 400)
    return () => clearTimeout(timer)
  }, [load, stickerTick])
  useEffect(() => { if (stickerJob) setJob(stickerJob as Job) }, [stickerJob])
  useEffect(() => {
    if (!job?.running) return
    const timer = setInterval(() => { void api('/stickers/job').then((r) => r.job && setJob(r.job)).catch(() => {}) }, 1500)
    return () => clearInterval(timer)
  }, [job?.running])

  const batch = async (op: string, extra: any = {}, label?: string) => {
    try {
      const r = await api('/sticker/batch', { op, ids: sel, ...extra })
      if (r.job) setJob(r.job)
      toast(`${label ?? '已处理'} ${r.affected ?? r.job?.total ?? 0} 张`)
      if (op !== 'classify') setSel([])
      load()
    } catch (e) { toast((e as Error).message) }
  }

  const upload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name))
    if (!images.length) { toast('只能拖图片进来（png/jpg/gif/webp）'); return }
    const payload: { name: string, dataUrl: string }[] = []
    for (const file of images.slice(0, 40)) {
      payload.push({ name: file.name, dataUrl: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(`读不了 ${file.name}`))
        reader.readAsDataURL(file)
      }) })
    }
    toast(`正在导入 ${payload.length} 张…`)
    try {
      const r = await api('/stickers/upload', { files: payload })
      if (r.job) setJob(r.job)
      if (r.skipped?.length) toast(`跳过：${r.skipped.join('、')}`)
      else toast(`导入 ${r.ids.length} 张${r.job ? '，正在自动分类' : ''}`)
      load()
    } catch (e) { toast((e as Error).message) }
  }

  const stickers = data?.stickers ?? []
  const types = data?.types ?? []
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id
  const stats = data?.stats
  const toggleSel = (id: number) => setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  const current = detail !== undefined ? stickers.find((s) => s.id === detail) : undefined
  // Type filters are ANDed, so "未分类" only makes sense as the inverse of them:
  // picking one drops the other instead of silently returning nothing.
  const pickTag = (id: string) => { setUntagged(false); setTags(tags.includes(id) ? tags.filter((x) => x !== id) : [...tags, id]) }
  const pickUntagged = () => { setUntagged(!untagged); setTags([]) }
  const pickUntaggedStickers = () => setSel(stickers.filter((s) => !s.tags.length).map((s) => s.id))

  return (
    <div className={css.root}
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; if (e.dataTransfer.types.includes('Files')) setDropping(true) }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false) }}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDropping(false); void upload([...e.dataTransfer.files]) }}
    >
      <Header title="表情" sub={`共 ${stats?.total ?? 0} 张 · 启用 ${stats?.enabled ?? 0} · 未分类 ${stats?.untagged ?? 0} · 未写描述 ${stats?.undescribed ?? 0} · 自动补表情在「设置」里`}>
        <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>上传图片</Button>
        <Button size="sm" variant="outline" icon={<Download size={14} />} onClick={() => setImporting(true)}>从 QQ 导入收藏</Button>
      </Header>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void upload([...e.target.files]); e.target.value = '' }} />

      <div className={css.bar}>
        <div className={css.chips}>
          {types.map((t) => {
            const on = tags.includes(t.id)
            return (
              <button key={t.id} title={t.desc} className={`${css.chip} ${on ? css.chipOn : ''}`}
                onClick={() => pickTag(t.id)}>
                {t.name}<span className={css.chipCount}>{data?.tagCounts[t.id] ?? 0}</span>
              </button>
            )
          })}
          <button className={`${css.chip} ${untagged ? css.chipOn : ''}`} title="筛出没有类型标签的表情（分类失败或还没跑过分类的那些）"
            onClick={pickUntagged}>
            未分类<span className={css.chipCount}>{stats?.untagged ?? 0}</span>
          </button>
        </div>
        <span className={css.sep} />
        <input className={`${css.chip} ${css.search}`} style={{ padding: '4px 10px' }} placeholder="搜描述 / 标题 / 分组" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className={css.textarea} style={{ width: 130 }} value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="weight">按权重</option>
          <option value="uses">按用得最多</option>
          <option value="newest">最新导入</option>
          <option value="oldest">最早导入</option>
        </select>
        <Switch label="只看启用" checked={enabledOnly} onChange={setEnabledOnly} />
        <span className={css.spacer} />
        <Button size="sm" variant="ghost" onClick={() => setSel(stickers.map((s) => s.id))}>全选</Button>
        <Button size="sm" variant="ghost" onClick={() => setSel(stickers.filter((s) => !sel.includes(s.id)).map((s) => s.id))}>反选</Button>
        <Button size="sm" variant="ghost" disabled={!stickers.some((s) => !s.tags.length)} onClick={pickUntaggedStickers}>选中未分类</Button>
        <Button size="sm" variant="ghost" disabled={!sel.length} onClick={() => setSel([])}>清空</Button>
      </div>

      <div className={css.body}>
        {job && <div style={{ marginBottom: 12 }}><JobBar job={job} onCancel={() => void api('/stickers/job/cancel', {}).then(() => toast('已请求取消'))} /></div>}
        {!stickers.length && <div className={css.empty}>{data ? '没有符合条件的表情。点右上角「从 QQ 导入收藏」，或把图片拖进来。' : '加载中…'}</div>}
        <div className={css.grid}>
          {stickers.map((s) => (
            <div key={s.id} className={`${css.tile} ${sel.includes(s.id) ? css.tileOn : ''} ${s.enabled ? '' : css.tileOff}`} onClick={() => setDetail(s.id)}>
              <div className={css.thumb}><img src={thumbUrl(s.id)} loading="lazy" alt="" /></div>
              <span className={`${css.check} ${sel.includes(s.id) ? css.checkOn : ''}`} onClick={(e) => { e.stopPropagation(); toggleSel(s.id) }}>
                {sel.includes(s.id) && <Check size={12} />}
              </span>
              {s.format === 'animated' && <span className={css.badge}>动</span>}
              <div className={css.tileText}>
                <div className={`${css.tileDesc} ${s.desc ? '' : css.tileDescNone}`}>{s.desc || (s.error ? '分类失败，点开看看' : '还没有描述')}</div>
                <div className={css.tileFoot}>
                  {s.tags.length ? s.tags.map((t) => <span key={t} className={css.tagPill}>{typeName(t)}</span>) : <span className={`${css.tagPill} ${css.tagPillNone}`}>未分类</span>}
                  <span className={css.spacer} />
                  <span title="权重">{s.weight}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {sel.length > 0 && (
        <div className={css.batch}>
          <span className={css.strong}>已选 {sel.length} 张</span>
          <Button size="sm" variant="ghost" onClick={() => batch('enable', {}, '启用')}>启用</Button>
          <Button size="sm" variant="ghost" onClick={() => batch('disable', {}, '禁用')}>禁用</Button>
          <span className={css.sep} />
          <span className={css.picker}>
            类型
            <select defaultValue="" onChange={(e) => { if (e.target.value) { void batch('tag-add', { tag: e.target.value }, '加类型'); e.target.value = '' } }}>
              <option value="">加…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select defaultValue="" onChange={(e) => { if (e.target.value) { void batch('tag-remove', { tag: e.target.value }, '去类型'); e.target.value = '' } }}>
              <option value="">去…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </span>
          <span className={css.sep} />
          <Button size="sm" variant="ghost" onClick={() => batch('weight-add', { value: 10 }, '权重 +10：')}>权重 +10</Button>
          <Button size="sm" variant="ghost" onClick={() => batch('weight-add', { value: -10 }, '权重 -10：')}>权重 -10</Button>
          <span className={css.picker}>
            设为
            <select defaultValue="" onChange={(e) => { if (e.target.value) { void batch('weight-set', { value: Number(e.target.value) }, '权重设为'); e.target.value = '' } }}>
              <option value="">…</option>
              {[0, 25, 50, 75, 100].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </span>
          <span className={css.sep} />
          <Button size="sm" variant="ghost" icon={<Sparkles size={13} />} onClick={() => batch('classify', { force: true }, '重新分类')}>重新分类</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => { if (confirm(`删除选中的 ${sel.length} 张表情？`)) void batch('delete', {}, '删除') }}>删除</Button>
          <span className={css.spacer} />
          <Button size="sm" variant="ghost" onClick={() => setSel([])}>取消选择</Button>
        </div>
      )}

      {current && <Detail sticker={current} types={types} toast={toast} onJob={setJob} onClose={() => setDetail(undefined)} onSaved={load} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onJob={setJob} toast={toast} />}
      {dropping && <div className={css.drop}>松手导入表情图片</div>}
    </div>
  )
}
