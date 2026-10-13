/**
 * GitHub notifications -> task sessions. Polls the bot account's notification
 * inbox (gh api, uses the gh login) and forwards new comments/reviews on PRs
 * or issues owned by a task to that task's worker session.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OrangeBot } from './bot.ts'

const run = promisify(execFile)

async function gh<T = any>(args: string[]): Promise<T> {
  const { stdout } = await run('gh', args, { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })
  return stdout.trim() ? JSON.parse(stdout) : (undefined as T)
}

export function startNotificationPoller(bot: OrangeBot, intervalMs = 120_000): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let me: string | undefined

  const tick = async () => {
    try {
      const authed = await run('gh', ['auth', 'status'], { timeout: 30_000 }).then(() => true, () => false)
      if (!authed) { if (!stopped) timer = setTimeout(tick, intervalMs * 5); return }
      me ??= (await gh<{ login: string }>(['api', 'user'])).login
      const since = bot.store.get<string>('gh:since', new Date(Date.now() - 86400_000).toISOString())
      const now = new Date().toISOString()
      const notes = await gh<any[]>(['api', `notifications?all=false&participating=true&since=${encodeURIComponent(since)}`])
      for (const n of notes ?? []) {
        const repo = n.repository?.full_name as string
        const url: string = n.subject?.url ?? ''
        const number = url.split('/').pop() ?? ''
        const task = bot.store.taskByPr(repo, number)
        if (!task) continue
        const kind = n.subject?.type === 'PullRequest' ? 'pulls' : 'issues'
        const lastSeen = bot.store.get<string>(`gh:seen:${repo}#${number}`, task.created ? new Date(task.created).toISOString() : since)
        const comments = await gh<any[]>(['api', `repos/${repo}/issues/${number}/comments?since=${encodeURIComponent(lastSeen)}`]).catch(() => [])
        const reviews = kind === 'pulls' ? await gh<any[]>(['api', `repos/${repo}/pulls/${number}/reviews`]).catch(() => []) : []
        const reviewComments = kind === 'pulls' ? await gh<any[]>(['api', `repos/${repo}/pulls/${number}/comments?since=${encodeURIComponent(lastSeen)}`]).catch(() => []) : []
        const fresh = [
          ...comments.map((c) => ({ at: c.created_at, who: c.user?.login, body: c.body, where: 'comment' })),
          ...reviews.filter((r) => r.submitted_at > lastSeen && r.body).map((r) => ({ at: r.submitted_at, who: r.user?.login, body: `[${r.state}] ${r.body}`, where: 'review' })),
          ...reviewComments.map((c) => ({ at: c.created_at, who: c.user?.login, body: `${c.path}:${c.line ?? c.original_line ?? ''} ${c.body}`, where: 'review comment' })),
        ].filter((c) => c.who !== me && c.at > lastSeen).sort((a, b) => a.at.localeCompare(b.at))
        bot.store.set(`gh:seen:${repo}#${number}`, now)
        if (!fresh.length) continue
        const textBody = `GitHub 上 ${repo}#${number} 有新的反馈：\n` + fresh.map((c) => `- ${c.who} (${c.where}, ${c.at}): ${c.body}`).join('\n')
          + `\n\n如果是修改要求，请在原分支上修改并 push，然后在 GitHub 上简短回复；如果需要在群里告知，用 say。`
        await bot.messageTask(task.id, textBody)
      }
      bot.store.set('gh:since', now)
      failures = 0
      await gh(['api', '-X', 'PUT', 'notifications', '-f', `last_read_at=${now}`]).catch(() => undefined)
    } catch (error) {
      const message = (error as Error).message ?? String(error)
      // transient network failures retry on the next tick; only report repeated failures
      failures++
      if (!/not logged|auth login|401/.test(message) && failures >= 5) {
        failures = 0
        await bot.reportError('github notifications (5 consecutive failures)', error)
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }
  let failures = 0
  timer = setTimeout(tick, 30_000)
  return () => { stopped = true; clearTimeout(timer) }
}
