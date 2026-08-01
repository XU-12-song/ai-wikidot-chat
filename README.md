# Chat

基于 DeepSeek-V4 的 AI 对话应用，支持对话分支、流式输出、工具调用，并内置笔记与解析功能。

## 功能

- **流式聊天** — SSE 实时输出，支持 reasoning（思考链）折叠展示和 tool-chip 工具调用提示
- **对话分支** — fork 分支、编辑消息自动新分支、分支间导航、共享消息跨分支查看
- **模型参数配置** — 每个会话独立设置 model / temperature / max_tokens / top_p / system_prompt / reasoning_effort
- **笔记** — 选中文字右键 → 添加笔记，AI 流式生成词汇解释，渲染为下划线标注（hover 扩展填充），点击查看
- **解析** — 两种模式：
  - 选中文字 → 解析选中内容，标记涉及的所有块级元素（左侧色条），一键分析
  - 无选中右键 → 进入元素选择模式，点击选取相邻块元素，批量分析
- **暗色模式** — 点击主题按钮切换
- **Markdown 渲染** — CDN 加载 marked 解析，回退自实现（表格、代码块、列表）
- **右键菜单** — 可扩展的上下文菜单系统（按 selection / default 注册不同菜单项）
- **维基知识库工具** — AI 可自动调用 searchPages / getPageContent / getChildPages / webSearch / webFetch

## 快速开始

```bash
# 0. 前置要求：Node.js >= 22

# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 3. 同步维基数据（如需使用维基工具，可选）
npm run wikidot-sync

# 4. 启动
npm start       # 生产模式
npm run dev     # 开发模式（文件变更自动重启）
```

访问 `http://localhost:3000`

## 项目结构

```
├── index.js                    # 入口：初始化 DB + 启动服务
├── server.js                   # Express 应用，导出 app，挂载路由与静态文件
├── src/
│   ├── config.js               # OpenAI 客户端配置，API Key 校验
│   ├── pool.js                 # SQLite 数据库连接（wikidot-chat.db）
│   ├── db.js                   # 数据库建表与迁移（conversations / branches / messages / notes）
│   ├── helpers.js              # 通用查询辅助（getBranchMessages）
│   ├── routes/
│   │   ├── conversations.js    # 会话 CRUD + 参数配置
│   │   ├── chat.js             # 流式聊天 + 同步回退
│   │   ├── branches.js         # 分支管理（列表/创建/切换）
│   │   ├── messages.js         # 消息编辑（自动分支）+ 重新生成
│   │   └── notes.js            # 笔记/解析创建（SSE 流式 AI 生成）
│   ├── services/
│   │   ├── conversation.service.js
│   │   ├── branch.service.js
│   │   ├── chat.service.js
│   │   ├── message.service.js
│   │   └── note.service.js
│   └── tools/
│       ├── tool-loop.js        # 通用 runToolLoop 引擎 + createToolExecutor 工厂
│       ├── index.js            # SCP 工具调度 + 系统提示词
│       ├── web.tool.js         # webSearch（Bing）+ webFetch
│       ├── wikidot.tool.js     # searchPages / getPageContent / getChildPages
│       ├── utils.js            # 排序、标签、作者解析
│       ├── content.js          # getPageContent 实现（iframe 处理）
│       └── note/
│           └── index.js        # 笔记/解析工具定义 + 系统提示词
├── public/
│   ├── index.html              # SPA 入口
│   ├── js/
│   │   ├── api.js              # fetch 封装
│   │   ├── utils.js            # esc / md / toast / showConfirm / showPrompt
│   │   ├── context-menu.js     # 可扩展右键菜单类
│   │   ├── notes.js            # 笔记卡片 SSE + 标注渲染
│   │   ├── analysis.js         # 解析卡片 SSE + 元素选择 + 侧边条渲染
│   │   └── app.js              # 主逻辑：状态管理 / 流式对话 / 渲染 / 事件委托
│   └── css/
│       ├── base.css            # CSS 变量 + 全局重置
│       ├── sidebar.css         # 侧栏样式
│       ├── main.css            # 主区域布局
│       ├── chat.css            # 消息气泡 / markdown / reasoning / 工具芯片
│       ├── settings.css        # 设置面板
│       ├── confirm.css         # 确认弹窗
│       └── notes.css           # 右键菜单 / 笔记卡片 / 分析条 / 元素选择模式
├── scripts/
│   └── wikidot-sync/           # Wikidot 站点爬取与同步脚本
└── wikidot-chat.db             # 统一数据库（SQLite）
```

## API

### 会话

| 方法     | 路径                              | 说明                     |
| -------- | --------------------------------- | ------------------------ |
| `GET`    | `/api/conversations`              | 会话列表                 |
| `POST`   | `/api/conversations`              | 创建会话                 |
| `GET`    | `/api/conversations/:id`          | 会话详情（含消息和笔记） |
| `DELETE` | `/api/conversations/:id`          | 删除会话                 |
| `PUT`    | `/api/conversations/:id/settings` | 更新模型参数             |

### 聊天

| 方法   | 路径                                     | 说明                            |
| ------ | ---------------------------------------- | ------------------------------- |
| `POST` | `/api/conversations/:id/chat`            | 流式聊天（SSE）                 |
| `POST` | `/api/conversations/:id/chat-sync`       | 同步聊天                        |
| `POST` | `/api/conversations/:id/regenerate`      | 重新生成最后一条 AI 回复（SSE） |
| `PUT`  | `/api/conversations/:id/messages/:msgId` | 编辑消息（自动创建新分支）      |

### 分支

| 方法   | 路径                                     | 说明             |
| ------ | ---------------------------------------- | ---------------- |
| `GET`  | `/api/conversations/:id/branches`        | 分支列表         |
| `POST` | `/api/conversations/:id/branches`        | 创建分支（fork） |
| `PUT`  | `/api/conversations/:id/branches/switch` | 切换活跃分支     |

### 笔记 / 解析

| 方法   | 路径             | 说明                           |
| ------ | ---------------- | ------------------------------ | ---------------------------------------- |
| `GET`  | `/api/notes/:id` | 获取笔记详情                   |
| `POST` | `/api/notes`     | 创建笔记或解析（`form: 'note'` | `'analysis'`），SSE 流式返回 AI 生成内容 |

## 技术栈

- **运行时**: Node.js >= 22
- **框架**: Express 5
- **数据库**: node:sqlite（DatabaseSync）
- **AI**: DeepSeek-V4 API（OpenAI 兼容，支持 reasoning + function calling）
- **前端**: 原生 JS + CSS（零构建工具，CDN 加载 marked）

## 许可

ISC
