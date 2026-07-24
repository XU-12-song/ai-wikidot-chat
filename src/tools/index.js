import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { searchPages, getChildPages } from './database.js';
import { getPageContent } from './content.js';
import { webSearch, webFetch } from './web.js';
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
4. **webSearch** – 搜索外部网络（讨论、二创、解读等补充信息）。
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

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'searchPages',
      description:
        'Structured search of SCP-CN wiki pages. ' +
        'All column filters are optional AND combined. ' +
        'At least one filter should be provided. ' +
        'Returns up to N page summaries (name, title, upvote, downvote, rating, author, tags, source_form, created_at, parent_name) without full source.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'LIKE match on page fullname, e.g. "4725"' },
          title: { type: 'string', description: 'LIKE match on page title, e.g. "SCP-CN"' },
          content: { type: 'string', description: 'LIKE match on page source body (wikitext / HTML)' },
          author: { type: 'string', description: 'LIKE match on author JSON, e.g. "Dr. Gears"' },
          tags: { type: 'array', items: { type: 'string' }, description: 'ALL these tags must be present (AND logic), e.g. ["scp","keter"]' },
          parent: { type: 'string', description: 'Exact match on parent_name, e.g. "scp-cn-4725"' },
          sourceForm: { type: 'string', enum: ['wikitext', 'html'], description: 'Exact match on source format (wikitext or html)' },
          pattern: { type: 'string', description: 'Legacy broad search across name, title, tags, source, author (OR logic). Use when you have a general keyword. Can be combined with other filters.' },
          sort: { type: 'string', enum: ['name', 'title', 'created_at', 'upvote', 'downvote', 'rating'], description: 'Sort column. Default: created_at' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction. Default: desc' },
          limit: { type: 'integer', description: 'Max results. Default: 20. Max: 50' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPageContent',
      description: '获取 SCP-CN 维基指定页面的完整源内容（HTML 或 wikitext）。html-block-iframe 会被自动处理。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '页面 fullname，如 "scp-cn-4725"、"experiment-log-914-cn"、"fragment:scp-cn-4345-1"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getChildPages',
      description: '获取某个页面的所有子页面列表。用于迭代页（实验记录）、故事系列等多页内容场景。',
      parameters: {
        type: 'object',
        properties: {
          parentName: { type: 'string', description: '父页面 fullname' },
          order: { type: 'string', enum: ['name', 'created_at', 'upvote', 'rating'], description: '排序字段：name=名称字典序（默认）、created_at=创建时间、upvote=好评数、rating=总评分（upvote-downvote）' },
          limit: { type: 'integer', description: '返回数量上限，不设则返回全部' },
        },
        required: ['parentName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webSearch',
      description: '使用搜索引擎搜索外部网络信息（SCP 相关的讨论帖、解读文章、二创等）。仅在维基数据库信息不足时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webFetch',
      description: '抓取指定 URL 的网页内容，提取纯文本。用于获取 webSearch 结果中某个链接的详细内容。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的网页 URL' },
        },
        required: ['url'],
      },
    },
  },
];

// ─── Tool dispatcher ───────────────────────────────────────────────────────────

const MAX_SOURCE_LEN = 500000;

export async function executeTool(name, args) {
  switch (name) {
    case 'searchPages': {
      const r = searchPages(args);
      return JSON.stringify(r);
    }
    case 'getPageContent': {
      const r = await getPageContent(args.name);
      if (!r) return JSON.stringify({ error: `页面未找到: ${args.name}` });
      if (r.source && r.source.length > MAX_SOURCE_LEN) {
        r.source = r.source.slice(0, MAX_SOURCE_LEN)
          + `\n\n[... 内容已截断，原长度 ${r.source.length} 字符。如需完整内容请使用 getChildPages 获取子页面 ...]`;
      }
      return JSON.stringify(r);
    }
    case 'getChildPages': {
      const r = getChildPages(args.parentName, args.order || 'name', args.limit || -1);
      return JSON.stringify(r);
    }
    case 'webSearch': {
      const r = await webSearch(args.query);
      return JSON.stringify(r);
    }
    case 'webFetch': {
      const r = await webFetch(args.url);
      return JSON.stringify(r);
    }
    default:
      return JSON.stringify({ error: `未知工具: ${name}` });
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
