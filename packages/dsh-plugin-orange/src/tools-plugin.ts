/** Preset row: registers the orange tools into each agent scope that mounts the orange preset. */
import type { Context } from '@deepseek-ai/cordis'
import { registerTools } from './tools.ts'
import { getBot } from './registry.ts'

export const name = 'orange-tools'
export const inject = ['tools']

export function apply(ctx: Context) {
  registerTools(ctx, getBot)
}
