# orange-bot（橘波特）

> Orange (橘波特): a QQ group chat bot for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh). It watches **two views of the same QQ group** — the official bot (koishi) and a userbot (crossgram) — decides for itself when to speak up, hands real work to background task agents, and keeps a Web panel over everything it saw and did.

橘波特不是一个只会复读的命令行机器人。它在群里像个人：有人 @ 它、有人接它的话、或者群里在聊它主人维护的项目的 bug 时，它自己判断要不要插一句；需要查证的事情它不瞎猜，而是派给后台任务 agent 去翻源码、跑命令、提 PR。它同时接**两个平台**（QQ 官方 bot，以及和主人共号的 userbot），把同一个物理群的两行视图配对成一行，再在这上面做触发判定、会话、任务和面板。

这个仓库是它的**全部代码**：一个 dsh 插件 + 两个挂在 Satori 服务上的同伴插件。

## 三个包

| 包 | 跑在哪 | 提供什么 |
|---|---|---|
| [`packages/dsh-plugin-orange`](packages/dsh-plugin-orange) | DeepSeek Harness（`dsh web` profile） | 机器人本体：双平台接入、消息库、触发合并与分类器、chat agent、后台任务 worker、agent 工具、Web 面板 |
| [`packages/koishi-plugin-orange-bridge`](packages/koishi-plugin-orange-bridge) | koishi（官方 bot 侧） | 官方 bot 那几个 Satori 表达不了的 HTTP 面：C2C 私聊发送、被动回复、群名、成员角色、撤回、指令表 |
| [`packages/orange-ext`](packages/orange-ext) | crossgram（userbot 侧） | 全量消息 WS、历史、合并转发展开、reaction、撤回、成员角色、消息查询、表情（收藏夹） |

> `orange-ext` 是 crossgram monorepo（`@mtproto-relay/*`）里的插件，依赖那边的 `@mtproto-relay/bridge` 类型，所以它**不在本仓库的 pnpm workspace 里**：源码放在这儿，装法见它自己的 README。

## 拓扑

```
QQ 群
  │
  ├─ 官方 bot ─ koishi ────────────┐  /satori/v1/*       事件流（Satori op:3 identify）
  │             + orange-bridge ───┤  /satori/orange/*   send / guild / member / recall / commands
  │                                │
  └─ userbot ─ crossgram ──────────┤  /satori/v1/message.create   出站发送
               + orange-ext ───────┤  /satori/orange/events (WS)   全量消息流（含自己发的）
                                   │  /satori/orange/*            history / forward / reaction / sticker / member.roles / …
                                   ▼
                        反向代理（例如 Caddy，两条 HTTPS 入口）
                                   │
                                   ▼
                     dsh（web profile）+ dsh-plugin-orange
                     ├─ SQLite：消息 / 响应 / 分类 / 任务 / 记忆 / 用量 / 表情 / 群角色
                     ├─ chat agent：每个会话一个 session
                     ├─ 后台 task worker：带完整 shell，会开子 agent、会提 PR
                     └─ Web 面板：/orange-api/*（会话、响应记录、任务、表情、用量、设置）
```

## 截图

面板（`dsh web` 侧栏「🍊 Orange Bot」里的会话页：左侧是见过的所有群，右侧是两侧合一的消息流 + 触发原因）：

![会话](docs/screenshots/ui-chat.png)

| 响应记录：每条回复的触发方式、dry run、这次抽到的子风格 | 后台任务：worker 实时状态与 PR/issue |
|---|---|
| ![响应记录](docs/screenshots/ui-resp.png) | ![后台任务](docs/screenshots/ui-tasks.png) |

| 记忆与用户：长期记忆、用户标签（谁是开发者） | 用量：按类别与模型计的 token 与花销 |
|---|---|
| ![记忆与用户](docs/screenshots/ui-mem.png) | ![用量](docs/screenshots/ui-stats.png) |

| 设置：说话风格、表情、主人项目、旁听主题 | 表情库：类型筛选 / 搜索 / 权重 |
|---|---|
| ![设置](docs/screenshots/ui-settings.png) | ![表情库](docs/screenshots/stickers-panel.png) |

表情库的导入（从 QQ 收藏夹导入，视觉模型逐张自动分类并写一句话描述）：

| 导入进度 | 批量操作 | 表情设置 |
|---|---|---|
| ![导入](docs/screenshots/stickers-import.png) | ![批量](docs/screenshots/stickers-batch.png) | ![表情设置](docs/screenshots/stickers-settings.png) |

消息渲染：存下来的文本是**给模型看的**（`<quote>…</quote>`、`<forward …>`、`[图片 #12]`），面板负责把它摊平成给人看的样子——下面这组是修这个 bug 前后面板画面的对比：

| 修之前：引用里的合并转发直接把 XML 画出来 | 修之后：引用块 + 转发卡片 |
|---|---|
| ![before](docs/screenshots/quote-before-forward.png) | ![after](docs/screenshots/quote-after-forward.png) |

| 引用里的图真的出图 | 我们自己写的那行 `> 名字：…` 也画成引用块 |
|---|---|
| ![引用里的图](docs/screenshots/quote-after-image.png) | ![自渲染引用行](docs/screenshots/quote-after-own-line.png) |

## 装起来

### 0. 需要什么

- 一台能跑 dsh 的机器（Node ≥ 22）；
- 一个 koishi（官方 bot 侧，装 `@satorijs/adapter-qq`）+ 本仓库的 `koishi-plugin-orange-bridge`；
- 一个 crossgram（userbot 侧）+ 本仓库的 `orange-ext`；
- 一个 OpenAI 兼容的模型端点（分类器、聊天、任务、表情分类、风格润色都走它）；
- 两条能到上面两个 Satori 服务的 HTTPS 入口（同一域名不同端口也行），因为两边都靠 Bearer token 认证。

### 1. 把同伴插件装到两侧

koishi 侧：

```bash
# 在 koishi 的 app 目录里
npm install /path/to/orange-bot/packages/koishi-plugin-orange-bridge
```

```yaml
# koishi.yml
plugins:
  orange-bridge:
    path: /satori/orange
    token: <和 dsh 侧 ORANGE_KOISHI_TOKEN 相同>
```

crossgram 侧：把那 `packages/orange-ext` 放进 crossgram monorepo 的 packages 下并加进它的 workspace 依赖，
配置 `path: /satori/orange`、`token: <和 ORANGE_CROSSGRAM_TOKEN 相同>`、`platformId: qqnt`；细节见
[`packages/orange-ext/README.md`](packages/orange-ext/README.md)。

### 2. 反向代理

```caddy
# /etc/caddy/Caddyfile
https://bot.example.com:41008 {                       # koishi
	@satori path /satori/v1/* /satori/orange/*
	handle @satori { reverse_proxy 127.0.0.1:5140 }
	respond 404
}

https://bot.example.com:41009 {                       # crossgram
	@satori path /satori/v1/* /satori/orange/*
	handle @satori { reverse_proxy 127.0.0.1:3140 }
	respond 404
}
```

### 3. 挂到 dsh

```bash
git clone https://github.com/std-microblock/orange-bot.git
cd orange-bot/packages/dsh-plugin-orange && npm install     # prepare 会顺手 build 一次
```

然后让 `dsh web` profile 依赖它并把包名加进 bundle 列表（完整步骤与配置表见
[`packages/dsh-plugin-orange/README.md`](packages/dsh-plugin-orange/README.md)）：

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": { "dsh-plugin-orange": "link:/path/to/orange-bot/packages/dsh-plugin-orange" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-orange"],
      "patchReload": "live"
    }
  }
}
```

### 4. 首次运行

新装的插件**谁都不回答、什么群都不存**：`admins`、白名单、`errorGroup` 默认都是空的。按顺序：

1. 起 `dsh web`，在启动日志里拿到带 token 的面板地址，侧栏会出现「🍊 Orange Bot」；
2. 把主人写进 `admins`（`qq:<user_openid>` / `cg:<uid>`），否则群里没人有管理权限；
3. 面板「会话」页把要聊的群加白名单（或管理员在群里 `/ai.white add <群号>`）；
4. 新群先开 **dry run**：照常思考、照常出响应记录，但不真的发出去。

## 端点契约

要做别的客户端、或者只想接一侧的话，这张表是全部要求（`<base>` 是配置里的 `endpoint`，例如
`https://bot.example.com:41008/satori`）：

| 端点 | 谁提供 | 说明 |
|---|---|---|
| `<base>/v1/*` | koishi 自带的 Satori 服务 | 官方 bot 的事件流（`op:3` identify）与其余 Satori API |
| `<base>/orange/send` | orange-bridge | 复用 koishi 的消息编码器发消息：C2C 私聊、被动回复（同一个 `msg_id` 的 `msg_seq` 递增）|
| `<base>/orange/guild` | orange-bridge | 群名/群标签（官方群事件里只有不透明的 `group_openid`）|
| `<base>/orange/member` | orange-bridge | 单个群成员的角色（事件没带 `member_role` 时的兜底）|
| `<base>/orange/recall` | orange-bridge | 撤回自己发的消息 |
| `<base>/orange/commands` | orange-bridge | koishi 已注册的指令别名，用来对 koishi 自己的指令保持沉默 |
| `<base>/v1/message.create` | crossgram 的 satori-exporter | userbot 侧的出站发送 |
| `<base>/orange/events`（WS） | orange-ext | 全量消息流，**含账号自己发出的**；连上后第一帧发 `{"token":…}` 认证，回 `{"type":"ready","selfId","loginId"}` |
| `<base>/orange/message.get` `message.recall` `history.list` `forward.get` `forward.send` `reaction.set` `reaction.catalog` `member.roles` `conversation.get` `sticker.packs` `sticker.list` `sticker.asset` `debug` | orange-ext | 见 [`packages/orange-ext/README.md`](packages/orange-ext/README.md) 的路由表 |

自查（两个 token 分别填）：

```bash
curl -sS -X POST -H "Authorization: Bearer $ORANGE_CROSSGRAM_TOKEN" \
     -H 'Content-Type: application/json' -d '{}' \
     https://bot.example.com:41009/satori/orange/debug
```

## 开发

```bash
pnpm install
pnpm build       # 只 build dsh 插件（node 半 + 面板 bundle）
pnpm typecheck   # tsc --noEmit
```

- `packages/dsh-plugin-orange`：TypeScript + esbuild；改 `src/client/` 之后要重新 build 才会生效（面板 bundle 由 dsh 的模块加载器接管，`react` 与 `@deepseek-ai/dsh-client-ui-*` 由宿主提供）。
- `packages/koishi-plugin-orange-bridge`：一个 CommonJS 文件，没有构建步骤；改完重启 koishi。
- `packages/orange-ext`：TypeScript，由 crossgram 自己加载（`main` 指向 `src/index.ts`）；它依赖 crossgram 的工作区，单独装不起来，改完重启 crossgram。
- 源码注释里出现的 `vm/debug/*-test.ts`（润色、`@` 解析、面板分词、表情…）是作者部署仓库里的**离线纯逻辑断言脚本**，没有随本仓库发布，因此在本仓库里跑不了。

## 隐私与安全

- **只存该存的**：白名单群（及其配对的对端行）才落消息；非白名单群只留群号/群名；除主人↔机器人的私聊，别人的私聊连会话行都不建。
- **工具按会话收敛**：历史、搜索、转发、图片、记忆只覆盖本会话服务的群和它的对端行；跨群要管理员触发，后台任务继承发起者的权限。
- **工具守卫**：任何 orange 会话都不许读机器人自己的数据库、凭据与会话记录（`~/.orange/`、`orange.db`、`/etc/orange`、`~/.dsh/sessions`、进程环境变量里的 token），命中直接拒绝并写日志。
- **入站审查**：非管理员触发的消息先过一遍（关键词 + 一次小模型调用，带缓存）：套别群/私聊内容、要机器人骂人或网暴、辱骂挑衅、涉政 → 完全不回应，也不进 agent 的上下文，只在响应记录里留一条审计。

## 许可

[MIT](LICENSE) © 2026 MicroBlock
