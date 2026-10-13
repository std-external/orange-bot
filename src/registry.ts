/** Process-global handle shared by the host plugin and the preset tools plugin. */
import type { OrangeBot } from './bot.ts'

const KEY = Symbol.for('dsh-plugin-orange.bot')
const holder = globalThis as unknown as Record<symbol, OrangeBot | undefined>

export function setBot(bot: OrangeBot | undefined): void { holder[KEY] = bot }
export function getBot(): OrangeBot | undefined { return holder[KEY] }
