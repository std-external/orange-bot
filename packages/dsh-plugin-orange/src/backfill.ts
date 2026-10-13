/**
 * One-time backfill of agent token usage from persisted session logs, for
 * sessions that ran before live accounting existed. Idempotent per session.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { OrangeBot } from './bot.ts'

export async function backfillUsage(bot: OrangeBot, sessionsRoot: string): Promise<void> {
  const done = new Set(bot.store.get<string[]>('usage:backfilled', []))
  for (const ws of await readdir(sessionsRoot).catch(() => [] as string[])) {
    for (const id of await readdir(join(sessionsRoot, ws)).catch(() => [] as string[])) {
      if (!id.startsWith('orange-') || done.has(id)) continue
      const role = bot.store.get<{ role: string, conv: string } | undefined>(`role:${id}`, undefined)
      if (!role) continue
      try {
        // the log is a multi-frame zstd stream; node's zstdDecompressSync stops after the first frame
        const text = execFileSync('zstdcat', [join(sessionsRoot, ws, id, 'session.v4.jsonl.zstd')], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
        for (const line of text.split('\n')) {
          if (!line.includes('"assistant/message"')) continue
          const e = JSON.parse(line)
          const usage = e.data?.usage
          if (e.type !== 'assistant/message' || !usage) continue
          bot.store.recordLlm({ kind: role.role, model: e.data.message?.source?.model ?? '', input: (usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0), cached: usage.cacheReadTokens ?? 0, output: usage.outputTokens ?? 0, conv: role.conv, ref: id })
        }
      } catch (error) {
        bot.log.warn(`usage backfill ${id}: ${(error as Error).message}`)
      }
      done.add(id)
    }
  }
  bot.store.set('usage:backfilled', [...done])
}
