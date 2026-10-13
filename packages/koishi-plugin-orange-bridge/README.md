# koishi-plugin-orange-bridge

koishi 侧的同伴插件：给橘波特补上 **koishi 自带的 Satori 服务表达不了**的那几个 HTTP 面。一个文件（`index.js`）、没有构建步骤、除 `koishi` 本身没有依赖。

装在跑 `@satorijs/adapter-qq` 的那个 koishi 上，它和 [dsh-plugin-orange](../dsh-plugin-orange) 通过 Bearer token 通信。

## 为什么需要它

QQ 官方 bot 的接口形状和 Satori 的消息模型对不上，这几件事只能拿到 koishi 内部的 adapter 才能做：

- **私聊（C2C）发送**：Satori 的 `message.create` 不会把频道标成 direct，adapter 就会拿 user openid 去调群接口，必然失败。这里显式构造 `channel.type = 1` 的 session。
- **被动回复配额**：QQ 要求回复时带上被回复消息的 `msg_id`，且同一个 `msg_id` 的 `msg_seq` 必须递增（重复的 `msg_id + msg_seq` 会被平台拒）。这里按 `msg_id` 缓存 session（5 分钟窗口，定时清理），于是连续几次回复里的 `msg_seq` 会一直涨。
- **群名**：官方群的事件里只有不透明的 `group_openid`，没有名字、没有头像。群名要走 adapter 的 `bot.internal.getGuildInfo()`。
- **成员角色**：群消息事件正常会带 `author.member_role`，没带的时候用 `bot.internal.getGuildMember()` 兜底。
- **撤回**：官方 API 只允许撤回约两分钟内自己发的消息，adapter 的 `bot.deleteMessage()` 会自己分群/私聊。
- **指令表**：告诉 dsh 侧 koishi 注册了哪些指令别名，这样群里 `@bot /ac` 这类消息由 koishi 回，机器人不会白唤醒一轮 agent。

事件流**不**走这里：koishi 自带的 Satori 服务把 `<endpoint>/v1/events` 给出来就够了（dsh 侧用标准的 `op:3` identify 连它）。

## 装

```bash
# 在 koishi 的 app 目录里
npm install /path/to/orange-bot/packages/koishi-plugin-orange-bridge
```

```yaml
# koishi.yml
plugins:
  orange-bridge:
    path: /satori/orange      # 默认值
    token: <TOKEN>            # 必填；dsh 侧的 ORANGE_KOISHI_TOKEN 要跟它一样
```

外网访问要同时放行 `/satori/v1/*`（事件流）和 `<path>/*`（本插件），例如 Caddy：

```caddy
https://bot.example.com:41008 {
	@satori path /satori/v1/* /satori/orange/*
	handle @satori { reverse_proxy 127.0.0.1:5140 }
	respond 404
}
```

完事重启 koishi（`systemctl restart koishi`）。koishi 重启的那几秒官方侧会断，dsh 侧会自动重连。

## 路由

所有路由都是 `POST <path>/<method>`，JSON 进 JSON 出，未带正确 `Authorization: Bearer <token>` 一律 401。请求体里的 `selfId` 可选（同一平台挂了多个机器人账号时用来指定一个）；成功回 `{"ok":true,"result":…}`，失败回 HTTP 500 + `{"ok":false,"error":"…"}`（错误详情直接来自 QQ 平台）。

| 路由 | 请求 | 响应 | 说明 |
|---|---|---|---|
| `/send` | `{selfId?, channelId, content, direct?, replyTo?: {messageId, ts}}` | `{result: [{id}]}` | 复用 koishi 的消息编码器，所以 `content` 是 Satori 元素串（`<qq:markdown>`、`<img>`、`<file>`、`<button-group>`…）。`replyTo` 落在 5 分钟窗口内才算被动回复，否则当主动消息发 |
| `/guild` | `{selfId?, channelId}` | `{result: {name, fingerMemo, tags, memberNum}}` | 群名（事件里没有） |
| `/member` | `{selfId?, channelId, userId}` | `{result: {role, name}}` | 单个成员的角色：`owner` / `admin` / `member` |
| `/recall` | `{selfId?, channelId, messageIds}` | `{result: {recalled, failed}}` | 一次最多 10 条；全部失败才算失败 |
| `/commands` | `{}` | `{result: {prefixes, commands}}` | koishi 已注册的指令别名 |

## 开发

- 纯 CommonJS 单文件，没有构建、没有类型检查；改完重启 koishi 生效（koishi 一般没开 HMR）。
- 想看 dsh 侧到底发了什么：`journalctl -u koishi -f | grep orange-bridge`，失败的调用会打 `warn`，里面带平台的原始错误 JSON。

## 许可

[MIT](../../LICENSE) © 2026 MicroBlock
