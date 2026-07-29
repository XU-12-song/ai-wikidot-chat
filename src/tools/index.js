import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { searchPages, getChildPages, getPageContent, WIKIDOT_TOOL_DEFINITIONS } from './wikidot.tool.js';
import { webSearch, webFetch, WEB_TOOL_DEFINITIONS } from './web.tool.js';
import { createToolExecutor, runToolLoop } from './tool-loop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../..', '.env') });

// ─── System prompt (injected into every conversation) ──────────────────────────

const siteName = process.env.SITE_NAME;

export const WIKIDOT_SYSTEM_PROMPT = `
## ${siteName} 维基知识库工具

你可以查询 ${siteName} 维基数据库。以下是可用的函数工具：

1. **searchPages** – 搜索维基页面（名称/标题/标签/内容/作者）。先搜索再读取。
2. **getPageContent** – 获取指定页面的完整内容。搜索到相关页面后用此读取正文。
3. **getChildPages** – 获取某页面的子页面列表。用于迭代页、实验记录、故事系列等有多页内容的场景。默认按名称排序。
4. **webSearch** – 搜索外部网络。
5. **webFetch** – 抓取网页全文。

你可以使用多种维基页面搜索方式，如果从name和title搜索不到，通过content字段可能能搜索到链接到该页面的文章

## SCP-CN 维基回应要求
1. 如果你想链接一段文本到一个scp页面，你不应该直接使用/页面名称，而是应该使用https://${siteName}.wikidot.com/页面名称
2. 通过\`https://www.wikidot.com/user:info/username\`可以链接到作者讯息页面
3. \`https://www.wikidot.com/avatar.php?userid=\${用户id}\`是此id的头像，可以直接使用[替代文字](图片URL)
4. \`https://www.wikidot.com/userkarma.php?u=\${用户id}&onlyKarma=true\`是显示此id的karma值的图片，类似社区活跃度，可以直接使用[替代文字](图片URL)
5. 当要链接到作者时，你应该也显示作者头像和作者karma值，而不是只显示作者名

当用户询问 SCP-CN 相关内容时，请使用以上工具查询真实数据后再回答。不要凭空编造任何条目内容。
`;

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const CHAT_TOOL_DEFINITIONS = [...WEB_TOOL_DEFINITIONS, ...WIKIDOT_TOOL_DEFINITIONS];

// ─── Tool executor ────────────────────────────────────────────────────────────

const MAX_SOURCE_LEN = 500000;

const toolMap = {
  searchPages: (args) => searchPages(args),
  getPageContent: async (args) => await getPageContent(args.name, MAX_SOURCE_LEN),
  getChildPages: (args) => getChildPages(args.parentName, args.order || 'name', args.limit || -1),
  webSearch: async (args) => await webSearch(args.query),
  webFetch: async (args) => await webFetch(args.url),
};

const executeScpTool = createToolExecutor(toolMap);

// ─── Convenience: runToolLoop pre-bound with WIKIDOT tools ────────────────────────

/**
 * Run the tool-calling loop with wikidot + web tools.
 *
 * @param {object} conv         conversation settings
 * @param {Array<object>} messages  API-formatted message history
 * @param {number} [maxIterations=20]
 * @returns {AsyncGenerator}  see {@link runToolLoop} in tool-loop.js
 */
export function runWikidotToolLoop(conv, messages, maxIterations = 20) {
  return runToolLoop(conv, messages, {
    tools: CHAT_TOOL_DEFINITIONS,
    executeTool: executeScpTool,
    maxIterations,
  });
}
