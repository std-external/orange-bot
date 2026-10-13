# dsh-plugin-orange（橘波特）

> Orange: a QQ group chat bot that lives inside [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) as a plugin. It bridges two Satori sides of the same QQ group (the official bot and a userbot), archives what it sees, decides for itself when to speak up, answers in chat while handing real work to background task agents, and gives the operator a Web panel over all of it.

「橘波特」是一个**群友型** QQ 机器人：不是只会复读的命令行工具，而是有人 @ 它、有人接它话、或者群里在聊它主人维护的项目的 bug 时，自己决定要不要插一句。它同时接**两个平台**——QQ 官方 bot（koishi + `@satorijs/adapter-qq`，走被动回复）和 userbot（crossgram，和主人共号，能看到全量消息）——把同一个物理群的两行视图配对成一行，然后在这上面做触发判定、会话、后台任务和面板。

- 群里说话：`say` 工具 + 「主风格 + 每条随机子风格重写」的润色链路，尽量不像一个模型在念稿
- 干活：判断需要查证的请求一律甩给后台 task worker（有完整 shell、会开子 agent、会提 PR），聊天 session 不自己调查
- 看得见：Web 面板（会话 / 响应记录 / 后台任务 / 记忆与用户 / 用量 / 表情 / 设置），每一步为什么被唤醒、发出去了什么、花了多少 token 都能查
- 有边界：白名单之外不存消息、别人私聊不建会话、工具守卫挡掉读自己数据库/凭据、非管理员的触发先过一遍内容审查

## 架构

```
QQ 群 ─┬─ 官方 bot（koishi / adapter-qq，`qq:<openid>`）─┐
       │                                                ├─► satori.ts 归一化
       └─ userbot（crossgram，`cg:<群号>`）──────────────┘        │
                                                                  ▼
   store.ts（SQLite：消息/会话/响应/分类/任务/记忆/用量/表情/角色）
                                                                  │
        ┌───────────────────────────────┬─────────────────────────┴──────────────┐
        ▼                               ▼                                        ▼
  触发与合并（bot.ts）             chat agent（每群一个 session）        web.ts + client/（面板）
  mention / /ai / 回复 / 分类器   └─ start_task ─► task worker（后台任务）
  wakeMergeMs 窗口内合成一条              └─ subagent（按需并行）
```

| 文件 | 作用 |
|---|---|
| `src/index.ts` | dsh 宿主入口：起 `OrangeBot`、挂面板 API、GitHub 通知轮询、用量记账、工具守卫 |
| `src/bot.ts` | 引擎：收两侧消息、落库、决定何时唤醒 agent、管每会话 session 与后台任务 |
| `src/satori.ts` | Satori 桥：两个适配器归一化成一个消息模型，`/orange/events` 事件流 + 扩展端点 |
| `src/qq.ts` | QQ 官方 bot 的平台怪癖：markdown/引用/@ 在不同平台各自要什么形状 |
| `src/pairing.ts` | 双平台同一群的配对（消息证据 + 群名），读时解析名字与头像 |
| `src/store.ts` | SQLite 持久化（`node:sqlite`，无原生依赖）与所有查询 |
| `src/prompts.ts` | 分类器 / 聊天 persona / 任务 worker / 表情分类 / 风格润色的提示词 |
| `src/tools.ts` | agent 工具（`say`、`chat_history`、`view_image`、`start_task`…），`tools-plugin.ts` 是预置行 |
| `src/mentions.ts` `src/markup.ts` `src/media.ts` | `@人`、存进库的小 markup（引用/合并转发/附件占位符）、附件 id 体系 |
| `src/style.ts` `src/stickers.ts` | 发送前的风格润色（纯函数 + 校验）、表情池与自动补表情 |
| `src/privacy.ts` | 隐私与内容策略：工具守卫、入站审查、只存该存的 |
| `src/web.ts` `src/client/` | 面板 API（`/orange-api/*`）与面板前端（React） |
| `src/github.ts` `src/llm.ts` `src/log.ts` `src/backfill.ts` | PR/issue 通知转任务、便宜模型直连调用、日志、用量回填 |

## 前置条件

1. **DeepSeek Harness**（`dsh`），插件的 peer 依赖是 `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`。
2. **两个 Satori 服务**（各一个 HTTPS 入口 + token）：
   - 官方 bot 侧：koishi + `@satorijs/adapter-qq`；
   - userbot 侧：crossgram。
   两侧都要暴露 `/orange/events` 和一组 `/orange/<method>` 扩展端点（`send` / `guild` / `member` / `commands` / `recall` / `message.recall` / `reaction.set` / `member.roles` / `forward.get` / `history.list` / `message.get` / `sticker.*`，调用点见 `src/satori.ts`）。
   **⚠️ 提供这些端点的两个同伴插件（koishi 侧 `koishi-plugin-orange-bridge`、crossgram 侧 `orange-ext`）目前不在本仓库里**，见下面「尚未开源的部分」。
3. **一个 OpenAI 兼容的模型端点**（分类器、聊天、任务、表情分类、风格润色都走它；`llm.provider` 只是 dsh 侧的 provider 名）。

## 安装

### 方式一：手动挂到 profile（作者线上部署用的方式）

```bash
# 1) 取代码并构建（prepare 脚本会在 install 时顺手 build 一次）
git clone https://github.com/std-microblock/dsh-plugin-orange.git /opt/orange/plugin
cd /opt/orange/plugin && npm install

# 2) 让 web profile 依赖它，并把包名加进 bundle 列表
#    （bundle 名就是包名；插件通过 dsh.bundle.patch 把自己的 patch 层插进组合树）
cat > ~/.dsh/profiles/web/package.json <<'EOF'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": { "dsh-plugin-orange": "link:/opt/orange/plugin" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-orange"],
      "patchReload": "live"
    }
  }
}
EOF

cd ~/.dsh/profiles/web && pnpm install
# 然后重启 dsh web（或在 profile 里启用 dsh-hmr 让它自己重载）
```

### 方式二：`dsh plugin`

`dsh plugin --profile web <pnpm args>` 会把参数转给 profile 目录里的 pnpm，所以
`dsh plugin --profile web add /opt/orange/plugin`（或一个 git 地址）等价于上面第 2 步的依赖部分；
`dsh.profile.bundles` 里仍然要有 `dsh-plugin-orange`，否则插件的 patch 层不会生效。

## 配置

插件的 patch 层（`cordis.patch.yml`）插两行：宿主行 `orange`（机器人本体 + 面板 API）和 `orange` agent preset（聊天/任务/子 agent 共用的工具与权限）。静态字段从 cordis 行/环境变量来：

| 配置 | 环境变量 | 说明 |
|---|---|---|
| `dataDir` | `ORANGE_DATA` | 数据目录，默认 `$HOME/.orange`（SQLite、表情文件、日志） |
| `workspace` | `ORANGE_WORKSPACE` | agent 的工作区根目录，默认 `$HOME/workspace` |
| `koishi.endpoint` / `.token` | `ORANGE_KOISHI_ENDPOINT` / `_TOKEN` | 官方 bot 侧的 Satori 地址与 token |
| `crossgram.endpoint` / `.token` | `ORANGE_CROSSGRAM_ENDPOINT` / `_TOKEN` | userbot 侧的 Satori 地址与 token |
| `llm.baseURL` / `.apiKey` | `ORANGE_LLM_BASE_URL` / `_KEY` | OpenAI 兼容端点与 key |
| `llm.model` / `llm.agentModel` / `llm.provider` | — | 默认模型（分类、润色、表情分类都用它）与 agent 用的模型 |
| `admins` | — | **机器人管理员**，`qq:<user_openid>` / `cg:<uid>`；唯一权限来源，默认空 |
| `errorGroup` | — | 出错上报到哪个会话，默认空 = 只写日志 |
| `agentPreset` | — | 聊天/任务用的 preset 名，默认 `orange` |

运行时可改的设置存在 SQLite 里，全部从面板改：`groups`（每会话白名单 / dry run / 旁听 / 标签 / 备注 / 对端）、`ownProjects`（主人维护的项目，分类器据此判断该不该唤醒）、`assistTopics`、`personaExtra`、`style`（主风格 + 子风格池 + 每次抽几条 + 温度 + 润色模型）、`stickers`（类型表、自动补表情概率与窗口）、`sessionIdleMs`、`wakeMergeMs`、`classifierEnabled`、`proactivePerHour`。

> 新装之后 `admins` 是空的、白名单是空的、`errorGroup` 是空的——机器人不回答任何人，也不存任何群的消息。这是故意的：先在面板里（或配置里）把主人和白名单配好。

## 首次运行

1. 启动 `dsh web`，在启动日志里拿到带 token 的面板地址（`dsh` 启动时打印），侧栏应当出现「🍊 Orange Bot」。
2. 把主人写进 `admins`（`qq:<user_openid>` / `cg:<uid>`），否则群里没人能用管理命令（面板不受影响）。
3. 白名单要聊的群：面板「会话」页勾白名单，或让管理员在群里发 `/ai.white add <群号|openid>`。
4. 建议先给新群开 **dry run**：照常思考、照常出响应记录，但不真的发出去，看几条满意了再关。

## 面板

| 页面 | 内容 |
|---|---|
| 会话 | 所有见过的会话（含未白名单的，便于加白名单）、搜索、白名单/dry run 徽章、最后一条消息预览 |
| 群聊 | 一个群的消息流：两侧合一、身份徽章、合并转发/引用/图片按 id 还原、面板内直接以橘波特身份发言、唤醒 / 重置 session / 设置 |
| 响应记录 | 每条回复：触发方式（`/ai`、@、旁听、任务、自动表情、不回复、审查、错误）、dry run 单独筛选、这次抽到的子风格、触发它的那条消息 |
| 后台任务 | 任务列表、worker 实时状态、PR/issue 链接、当前轮跑了多久、面板直接给任务发消息 |
| 记忆与用户 | 长期记忆、用户标签（谁是开发者）、事件日志 |
| 用量 | 按类别（分类器 / 聊天 / 任务 / 子 agent / 风格润色）和模型的 token 与估算花销 |
| 表情 | 表情库：网格 + 类型筛选 + 搜索 + 权重；导入 QQ 收藏、视觉模型自动分类与一句话描述、批量操作 |
| 设置 | 说话风格、表情、主人项目、旁听主题、人设补充等所有运行时设置 |

## agent 工具

聊天 agent 拿到的：`say`（说话，带引用/自动 @/实际发出内容回执）、`react`、`no_reply`、`send_sticker`、`sticker_search`、`recall`、`chat_history`、`chat_search`、`list_conversations`、`member_roles`、`get_forward`、`view_image`、`memory`、`user_tag`、`project_repos`、`start_task`、`list_tasks`、`task_message`、`task_update`、`group_config`。

## 群命令（仅机器人管理员）

`/ai <话>`（当成被 @ 直接问一句）、`/ai.white add|remove|list [id…]`、`/ai.dry on|off [id…]`、`/ai.reset [会话]`、`/ai.bg`（后台任务列表，群里任何人都能用，只列本群）。

## 隐私与安全

- **只存该存的**：白名单群（及其配对的对端行）才落消息；非白名单群只留群号/群名；除主人↔机器人的私聊，别人的私聊连会话行都不建。
- **工具按会话收敛**：历史/搜索/转发/图片/记忆只覆盖本会话服务的群和它的对端行；跨群要管理员触发，后台任务继承发起者的权限。
- **工具守卫**（硬底）：任何 orange 会话都不许读 `~/.orange/`、`orange.db`、`/etc/orange`、`~/.dsh/sessions` 或进程环境变量里的 token，命中直接拒绝并写日志。
- **入站审查**：非管理员触发的消息先过一遍（关键词 + 一次小模型调用，带缓存），套隐私 / 要求机器人骂人或网暴 / 辱骂挑衅 / 涉政 → 完全不回应，也不进 agent 的上下文，只在响应记录里留一条审计。
- **只读面板**：面板 API 挂在 dsh 自带的连接校验之后（cookie/host），不会自己开一个新的对外端口。

## 开发

```bash
npm install          # 依赖 + prepare 自动 build
npm run build        # esbuild：lib/index.js、lib/tools.js（node 半）、lib/client.js（面板 bundle）
npm run typecheck    # tsc --noEmit（tsconfig 是 noEmit 的）
```

- 源码里几处注释提到的 `vm/debug/*-test.ts`（`style-test`、`at-test`、`token-test`、`sticker-test`…）是作者部署仓库里的**离线纯逻辑断言脚本**，用来跑发送润色、`@` 解析、面板分词这类不依赖网络的部分；它们还没有随本仓库发布，所以在本仓库里跑不了。
- 改动 `src/client/` 之后要重新 `npm run build` 才会生效；面板 bundle 由 dsh 的模块加载器接管（`window.__ModuleLoader__`），`react` / `@deepseek-ai/dsh-client-ui-*` 由宿主提供，不进 bundle。

## 尚未开源的部分

这个插件不是一个通用的 Satori 客户端，它要连的那两个 Satori 服务上各有一个**同伴插件**，提供 `/orange/*` 扩展端点（全量事件流、发送、历史、合并转发、表情、成员角色、撤回…）：

- `koishi-plugin-orange-bridge`（官方 bot 侧）
- `crossgram` 的 `orange-ext`（userbot 侧）

它们目前不在这个仓库里，因此**单靠本仓库还不能端到端跑起来**；另外仓库里默认的人设、主人项目列表（`src/prompts.ts`、`src/config.ts` 的 `ownProjects`）写的是作者自己的项目，想让机器人服务别的项目，改这两处或在面板「设置」里改即可。

## 许可

[MIT](./LICENSE) © 2026 MicroBlock
