/** Minimal logger: stderr (journald) + rotating file in the data dir. */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Log {
  info(msg: string): void
  warn(msg: string): void
}

export function createLog(dir: string): Log {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'orange.log')
  const write = (level: string, msg: string) => {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`
    process.stderr.write(line)
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 20 * 1024 * 1024) renameSync(file, file + '.1')
      appendFileSync(file, line)
    } catch {}
  }
  return { info: (m) => write('I', m), warn: (m) => write('W', m) }
}
