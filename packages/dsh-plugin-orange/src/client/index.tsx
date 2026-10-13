/** Browser half: sidebar panel entry + main panel page. */
import { OrangePage } from './Page.tsx'

const PANEL_ID = 'orange'

function OrangeIcon({ size }: { size: number }) {
  return <span style={{ fontSize: size, lineHeight: 1 }}>🍊</span>
}

export const name = 'orange-client'
export const inject = ['slots']

export function apply(ctx: any): void {
  // jump from the panel into a real dsh conversation (session context, tool calls)
  const openSession = (id: string) => {
    const ws = ctx.get('uiWorkspace')
    if (ws) { ws.openSession(id); return }
    location.hash = ''
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ openSession }) }, OrangePage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => 'Orange Bot',
  }, OrangeIcon))
  // deep links (#orange/...) open the panel directly
  const openFromHash = () => {
    if (!location.hash.startsWith('#orange')) return
    try { ctx.get('layout')?.selectPanel(PANEL_ID) } catch {}
  }
  setTimeout(openFromHash, 0)
  addEventListener('hashchange', openFromHash)
  ctx.effect?.(() => () => removeEventListener('hashchange', openFromHash))
}
