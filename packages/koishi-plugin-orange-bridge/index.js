// koishi-plugin-orange-bridge: small HTTP surface for the orange bot that the
// generic Satori server cannot express for the QQ official adapter:
//  - C2C (private) sends: Satori message.create does not mark the channel as
//    direct, so the adapter would call the group API with a user openid.
//  - passive replies: one cached session per replied msg_id so msg_seq keeps
//    increasing across sends (QQ rejects a repeated msg_id+msg_seq pair).
// Bearer-token protected, JSON in/out, mounted under /satori/orange.
const { Schema } = require('koishi')

exports.name = 'orange-bridge'
exports.inject = ['server']
exports.Config = Schema.object({
  path: Schema.string().default('/satori/orange'),
  token: Schema.string().required(),
})

const PASSIVE_WINDOW = 5 * 60 * 1000 - 5000

exports.apply = (ctx, config) => {
  const logger = ctx.logger('orange-bridge')
  /** msg_id -> cached koishi session (carries the running msg_seq). */
  const passive = new Map()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [id, entry] of passive) if (now - entry.ts > PASSIVE_WINDOW) passive.delete(id)
  }, 60_000)
  ctx.on('dispose', () => clearInterval(sweep))

  const auth = (koa) => {
    if (koa.request.headers.authorization !== `Bearer ${config.token}`) {
      koa.status = 401
      koa.body = { ok: false, error: 'unauthorized' }
      return false
    }
    return true
  }
  const findBot = (selfId) => ctx.bots.find((bot) => bot.platform === 'qq' && (!selfId || bot.selfId === selfId))

  const makeSession = (bot, channelId, direct, replyTo) => {
    const key = replyTo?.messageId
    if (key && passive.has(key)) return passive.get(key).session
    const fresh = key && replyTo.ts && Date.now() - replyTo.ts < PASSIVE_WINDOW
    const session = bot.session({
      type: 'message',
      channel: { id: channelId, type: direct ? 1 : 0 },
      ...(direct ? {} : { guild: { id: channelId } }),
      user: { id: direct ? channelId : '' },
      ...(fresh ? { message: { id: key } } : {}),
      timestamp: fresh ? replyTo.ts : 0,
    })
    if (direct) session.userId = channelId
    if (fresh) passive.set(key, { ts: replyTo.ts, session })
    return session
  }

  // {selfId?, channelId, content, direct?, replyTo?: {messageId, ts}}
  ctx.server.post(`${config.path}/send`, async (koa) => {
    if (!auth(koa)) return
    const body = koa.request.body ?? {}
    try {
      const bot = findBot(body.selfId)
      if (!bot) throw new Error('qq bot not online')
      const channelId = String(body.channelId)
      const session = makeSession(bot, channelId, !!body.direct, body.replyTo)
      const { MessageEncoder } = bot.constructor
      const encoder = new MessageEncoder(bot, channelId, undefined, { session })
      const results = await encoder.send(String(body.content ?? ''))
      if (!results.length) {
        const errors = (encoder.errors ?? []).map((e) => e?.response?.data ? JSON.stringify(e.response.data) : String(e?.message ?? e))
        throw new Error(errors.length ? errors.join('; ') : 'nothing was sent')
      }
      koa.body = { ok: true, result: results.map((message) => ({ id: message.id })) }
    } catch (error) {
      const detail = error?.response?.data ? JSON.stringify(error.response.data) : (error?.message ?? String(error))
      logger.warn('send failed: %s', detail)
      koa.status = 500
      koa.body = { ok: false, error: detail }
    }
  })

  // {selfId?, channelId} -> {name, fingerMemo, tags, memberNum}: the QQ group's real
  // name. Group events carry only the opaque group_openid (no guild.name), and the
  // satori server does not route guild.get, so the official side asks here instead.
  ctx.server.post(`${config.path}/guild`, async (koa) => {
    if (!auth(koa)) return
    const body = koa.request.body ?? {}
    try {
      const bot = findBot(body.selfId)
      if (!bot) throw new Error('qq bot not online')
      const info = await bot.internal.getGuildInfo(String(body.channelId))
      koa.body = {
        ok: true,
        result: {
          name: info.group_name ?? '',
          fingerMemo: info.group_finger_memo ?? '',
          tags: info.group_tags ?? [],
          memberNum: info.group_member_num ?? 0,
        },
      }
    } catch (error) {
      const detail = error?.response?.data ? JSON.stringify(error.response.data) : (error?.message ?? String(error))
      logger.warn('guild info failed: %s', detail)
      koa.status = 500
      koa.body = { ok: false, error: detail }
    }
  })

  // {selfId?, channelId, userId} -> {role, name}: one QQ group member's role
  // (owner / admin / member). Group message events normally carry it as
  // `author.member_role`, so this only fills the gap when an event does not.
  ctx.server.post(`${config.path}/member`, async (koa) => {
    if (!auth(koa)) return
    const body = koa.request.body ?? {}
    try {
      const bot = findBot(body.selfId)
      if (!bot) throw new Error('qq bot not online')
      const member = await bot.internal.getGuildMember(String(body.channelId), String(body.userId))
      koa.body = { ok: true, result: { role: member?.member_role ?? '', name: member?.username ?? '' } }
    } catch (error) {
      const detail = error?.response?.data ? JSON.stringify(error.response.data) : (error?.message ?? String(error))
      logger.warn('member role failed: %s', detail)
      koa.status = 500
      koa.body = { ok: false, error: detail }
    }
  })

  // {selfId?, channelId, messageId} -> withdraw one of the bot's own messages.
  // The official API only accepts this within ~2 minutes of the send, and the
  // adapter routes group vs. private recall itself (bot.deleteMessage).
  ctx.server.post(`${config.path}/recall`, async (koa) => {
    if (!auth(koa)) return
    const body = koa.request.body ?? {}
    try {
      const bot = findBot(body.selfId)
      if (!bot) throw new Error('qq bot not online')
      const channelId = String(body.channelId)
      const ids = (Array.isArray(body.messageIds) ? body.messageIds : [body.messageIds]).map(String).filter(Boolean).slice(0, 10)
      if (!ids.length) throw new Error('messageIds required')
      const failed = []
      for (const id of ids) {
        try { await bot.deleteMessage(channelId, id) } catch (error) { failed.push({ id, error: error?.response?.data ? JSON.stringify(error.response.data) : (error?.message ?? String(error)) }) }
      }
      if (failed.length === ids.length) throw new Error(failed.map((f) => `${f.id}: ${f.error}`).join('; '))
      koa.body = { ok: true, result: { recalled: ids.filter((id) => !failed.some((f) => f.id === id)), failed } }
    } catch (error) {
      const detail = error?.response?.data ? JSON.stringify(error.response.data) : (error?.message ?? String(error))
      logger.warn('recall failed: %s', detail)
      koa.status = 500
      koa.body = { ok: false, error: detail }
    }
  })

  // {} -> {prefixes, commands}: every registered koishi command alias, so the bot can
  // stay silent on messages koishi itself handles (e.g. "@bot /ac").
  ctx.server.post(`${config.path}/commands`, async (koa) => {
    if (!auth(koa)) return
    const commander = ctx.$commander
    const names = new Set()
    for (const cmd of commander._commandList) for (const alias of Object.keys(cmd._aliases ?? {})) names.add(alias)
    const prefix = ctx.root.config.prefix
    koa.body = { ok: true, result: { prefixes: Array.isArray(prefix) ? prefix : [prefix ?? ''], commands: [...names] } }
  })
}
