# Chat

基于 DeepSeek-V4 的 AI 对话应用，支持对话分支、流式输出、思考过程展示，并集成 Wikidot 维基知识库工具调用（通过 `SITE_NAME` 配置目标站点，默认可用于 SCP-CN）。

## 功能

- **流式聊天** — SSE 实时输出，支持 reasoning（思考链）折叠展示
- **对话分支** — 可 fork 任意分支、编辑消息自动创建新分支、分支间导航
- **模型参数配置** — 每个会话独立设置 model / temperature / max_tokens / top_p / system_prompt / reasoning_effort
- **维基知识库工具** — 内置 5 个 function-calling 工具，AI 自动调用搜索/读取 Wikidot 维基数据（站点通过 `SITE_NAME` 配置）
- **Markdown 渲染** — CDN 加载 marked 解析，失败时回退自实现解析器（支持表格、代码块、列表等）
- **Tool chips** — 对话中实时显示 AI 调用的工具名称

## 快速开始

```bash
# 0. 前置要求：Node.js >= 22（需要 --env-file 内置 .env 支持）

# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env      # Linux / macOS
copy .env.example .env    # Windows
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 3. 同步维基数据（如需使用维基工具）
npm run wikidot-sync       # 生成 wikidot.db
# 若失败请使用科学上网再次尝试
# 可以通过Enter暂停
# 若中途退出未能获取完可重新执行，不会损失太多进度
# 通常花费6~48小时

# 4. 启动
npm start                  # 生产模式，如果你是使用者，那么这是你需要做的
npm run dev                # 开发模式（文件变更自动重启）
```

访问 `http://localhost:3000`

## 项目结构

```
├── server.js              # 入口，挂载路由与静态文件
├── src/
│   ├── config.js          # OpenAI 客户端配置，API Key 校验
│   ├── db.js              # SQLite 数据库初始化与迁移
│   ├── helpers.js         # 对话/消息查询辅助函数
│   ├── routes/
│   │   ├── conversations.js  # 会话 CRUD + 参数配置
│   │   ├── chat.js           # 流式聊天 + 同步回退
│   │   ├── messages.js       # 消息编辑（自动分支）+ 重新生成
│   │   └── branches.js       # 分支管理（创建/切换）
│   └── tools/
│       ├── index.js       # runToolLoop 生成器 + 工具调度 + 系统提示词
│       ├── database.js    # searchPages / getChildPages（wikidot.db）
│       ├── content.js     # getPageContent（含 iframe 内联处理）
│       ├── web.js         # webSearch（Bing）/ webFetch
│       └── utils.js       # 排序、标签提取、作者解析等工具函数
├── public/
│   └── index.html         # 前端 SPA（聊天界面、markdown 渲染、SSE 解析）
├── scripts/
│   ├── wikidot-sync/      # Wikidot 站点爬取与同步脚本
│   └── test/              # 搜索功能测试
├── chat.db                # 对话数据库（SQLite）
└── wikidot.db             # Wikidot 维基数据（通过 wikidot-sync 脚本同步生成）
```

## API 路由

| 方法     | 路径                                     | 说明                            |
| -------- | ---------------------------------------- | ------------------------------- |
| `GET`    | `/api/conversations`                     | 获取所有会话列表                |
| `POST`   | `/api/conversations`                     | 创建新会话                      |
| `GET`    | `/api/conversations/:id`                 | 获取会话详情（含消息）          |
| `DELETE` | `/api/conversations/:id`                 | 删除会话                        |
| `PUT`    | `/api/conversations/:id/settings`        | 更新会话模型参数                |
| `POST`   | `/api/conversations/:id/chat`            | 流式聊天（SSE）                 |
| `POST`   | `/api/conversations/:id/chat-sync`       | 同步聊天（回退）                |
| `POST`   | `/api/conversations/:id/regenerate`      | 重新生成最后一条 AI 回复（SSE） |
| `PUT`    | `/api/conversations/:id/messages/:msgId` | 编辑消息（自动创建新分支）      |
| `GET`    | `/api/conversations/:id/branches`        | 获取分支列表                    |
| `POST`   | `/api/conversations/:id/branches`        | 创建分支（fork）                |
| `PUT`    | `/api/conversations/:id/branches/switch` | 切换活跃分支                    |

## 维基工具

AI 在需要时会自动调用以下工具获取维基数据，无需手动干预：

1. **searchPages** — 全文搜索维基页面（名称/标题/标签/内容/作者）
2. **getPageContent** — 获取页面完整内容，自动处理 iframe 内联
3. **getChildPages** — 获取子页面列表（迭代页、故事系列）
4. **webSearch** — 外部搜索（Bing），获取维基补充信息
5. **webFetch** — 抓取网页全文

通过 `.env` 中的 `SITE_NAME` 可切换目标站点。

## 技术栈

- **后端**: Node.js + Express 5
- **数据库**: node:sqlite（DatabaseSync）
- **AI**: OpenAI-compatible API（DeepSeek-V4，支持 reasoning + function calling）
- **前端**: 原生 JS + CSS（零构建工具，CDN 加载 marked）

## 许可

ISC
