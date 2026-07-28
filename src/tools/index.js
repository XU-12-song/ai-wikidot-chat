import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { searchPages, getChildPages, getPageContent, WIKIDOT_TOOL_DEFINITIONS } from './wikidot.tool.js';

import { webSearch, webFetch, WEB_TOOL_DEFINITIONS } from './web.tool.js';
import { createOpenAIClient, THINKING_ENABLED } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../..', '.env') });

// ─── System prompt (injected into every conversation) ──────────────────────────

const siteName = process.env.SITE_NAME;

export const SCP_SYSTEM_PROMPT = `
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

// ─── Tool definitions (OpenAI function-calling format) ─────────────────────────

export const TOOL_DEFINITIONS = [WEB_TOOL_DEFINITIONS, WIKIDOT_TOOL_DEFINITIONS].flat();

// ─── Tool dispatcher ───────────────────────────────────────────────────────────

const MAX_SOURCE_LEN = 500000;

const tools = {
  // 同步工具可以直接返回结果
  searchPages: (args) => searchPages(args),

  // 异步工具加上内部特殊处理
  getPageContent: async (args) => await getPageContent(args, MAX_SOURCE_LEN),

  getChildPages: (args) => getChildPages(args.parentName, args.order || 'name', args.limit || -1),

  webSearch: async (args) => await webSearch(args.query),
  webFetch: async (args) => await webFetch(args.url)
};

async function executeTool(name, args) {
  const toolFn = tools[name];
  if (!toolFn) {
    return JSON.stringify({ error: `未知工具: ${name}` });
  }

  try {
    const result = await toolFn(args);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ error: error.message || '工具执行出错' });
  }
}

// ─── Tool-calling loop ─────────────────────────────────────────────────────────

/**
 * Async generator that handles the tool-calling loop with streaming.
 * Yields events as they arrive from the model:
 * - { type: 'reasoning_delta', content } — thinking chunk (real-time)
 * - { type: 'delta', content }          — response text chunk (real-time)
 * - { type: 'tool_call', name, args }   — tool invocation detected
 * - { type: 'done', content, reasoning_content, toolsCalled } — final answer
 *
 * @param {object} conv        — conversation settings (model, temperature, etc.)
 * @param {array}  messages    — API-formatted messages
 * @param {number} maxIterations — max tool-calling rounds (default 20)
 *
 * Usage:
 *   for await (const event of runToolLoop(conv, messages)) {
 *     switch (event.type) {
 *       case 'reasoning_delta': /* stream thinking *\/
 *       case 'delta':           /* stream content *\/
 *       case 'tool_call':       /* show tool chip *\/
 *       case 'done':            /* finalize *\/
 *     }
 *   }
 */
export async function* runToolLoop(conv, messages, maxIterations = 20) {
  const openai = createOpenAIClient();
  const msgs = [...messages];
  const toolsCalled = [];

  for (let i = 0; i < maxIterations; i++) {
    const stream = await openai.chat.completions.create({
      model: conv.model,
      messages: msgs,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: conv.temperature,
      max_tokens: conv.max_tokens,
      top_p: conv.top_p,
      reasoning_effort: conv.reasoning_effort || 'high',
      extra_body: { thinking: THINKING_ENABLED },
      stream: true,
    });

    let fullContent = '';
    let fullReasoning = '';
    const toolCallMap = {}; // index -> { id, name, arguments }

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.reasoning_content) {
        fullReasoning += delta.reasoning_content;
        yield { type: 'reasoning_delta', content: delta.reasoning_content };
      }

      if (delta.content) {
        fullContent += delta.content;
        yield { type: 'delta', content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallMap[idx]) {
            toolCallMap[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) toolCallMap[idx].id = tc.id;
          if (tc.function?.name) toolCallMap[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallMap[idx].arguments += tc.function.arguments;
        }
      }
    }

    const tcList = Object.values(toolCallMap);
    if (tcList.length > 0) {
      for (const tc of tcList) toolsCalled.push(tc.name);

      const assistantMsg = {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: tcList.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      msgs.push(assistantMsg);

      for (const tc of tcList) {
        let args;
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }
        yield { type: 'tool_call', name: tc.name, args };
        const result = await executeTool(tc.name, args);
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      continue;
    }

    // Final answer
    yield {
      type: 'done',
      content: fullContent,
      reasoning_content: fullReasoning || null,
      toolsCalled: [...toolsCalled],
    };
    return;
  }

  // Loop ended (max iterations reached)
  yield {
    type: 'done',
    content: '',
    reasoning_content: null,
    toolsCalled: [...toolsCalled],
  };
}
