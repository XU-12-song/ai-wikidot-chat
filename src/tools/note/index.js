import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { WEB_TOOL_DEFINITIONS, webSearch, webFetch } from '../web.tool.js';
import { WIKIDOT_TOOL_DEFINITIONS } from '../wikidot.tool.js';
import { WIKIDOT_SYSTEM_PROMPT } from '../index.js';
import { searchPages, getChildPages, getPageContent } from '../wikidot.tool.js';
import { getContent } from './content.js';
import { createToolExecutor, runToolLoop } from '../tool-loop.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../..', '.env') });

const siteName = process.env.SITE_NAME;

// ─── Note tool definitions ────────────────────────────────────────────────────

/** @type {Array<object>} OpenAI function-calling tool definitions for note generation */
export const NOTE_TOOL_DEFINITIONS = [
    ...WEB_TOOL_DEFINITIONS,
    ...WIKIDOT_TOOL_DEFINITIONS,
    {
        type: 'function',
        function: {
            name: 'getContent',
            description: '获取当前消息的上下文内容',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer', description: '消息 ID' },
                },
                required: ['id'],
            },
        },
    },
];

// ─── Note tool executor ───────────────────────────────────────────────────────


const noteToolMap = {
    searchPages: (args) => searchPages(args),
    getPageContent: async (args) => await getPageContent(args.name, MAX_SOURCE_LEN),
    getChildPages: (args) => getChildPages(args.parentName, args.order || 'name', args.limit || -1),
    getContent: (args) => getContent(args.id),
    webSearch: async (args) => await webSearch(args.query),
    webFetch: async (args) => await webFetch(args.url),
};
/**
 * Execute a note-specific tool.
 *
 * @param {string} name - tool name (webSearch | webFetch | getContent)
 * @param {object} args - parsed arguments
 * @returns {Promise<string>} JSON-serialised result
 */
const executeNoteTool = createToolExecutor(noteToolMap);

// ─── Convenience: runToolLoop pre-bound with note tools ───────────────────────

/**
 * Run the tool-calling loop with note tools (webSearch, webFetch, getContent).
 *
 * @param {object} conv           conversation settings
 * @param {Array<object>} messages  API-formatted message history
 * @param {number} [maxIterations=20]
 * @returns {AsyncGenerator} see {@link runToolLoop} in tool-loop.js
 */
export function runNoteToolLoop(conv, messages, maxIterations = 20) {
    return runToolLoop(conv, messages, {
        tools: NOTE_TOOL_DEFINITIONS,
        executeTool: executeNoteTool,
        maxIterations,
    });
}

// ─── System prompt ────────────────────────────────────────────────────────────

export const NOTE_SYSTEM_PROMPT = `
## 角色与任务
你是一个“小记生成者”。收到用户**来自另一个对话上下文**提供的词汇后，用简洁、准确的语言对其进行解释。
- 只允许讲最终内容生成入正文，不允许在正文出现类似“我先获取对话上下文，确认"历史记录"在当前对话中的具体指向。”的句子
- 必须使用**行内 Markdown 格式**（仅限加粗、斜体、\`代码\`、[链接]() 等，不得出现标题、列表、代码块、表格等块级元素）。  
- 严格控制在 **300 字以内**，不得超限。

## 可用工具
根据任务需要，你可以主动调用以下工具（仅需说明去向，不得在最终回复中暴露工具名称）：

1. **webSearch**：需要补充外部信息时，搜索网络获取实时或背景资料。  
2. **webFetch**：当 webSearch 返回的摘要不足时，抓取指定网页全文，提取准确细节。  
3. **getContent**：若用户词汇在当前对话上下文中有特殊含义或认为语义不清时，随时使用此工具提取相关上下文，确保解释贴合当前主题。

${WIKIDOT_SYSTEM_PROMPT}

## 行为约束
- 不要生成任何除解释用户给出词汇以外的事
- 解释时优先使用自身知识；不确定或需最新信息时再调用工具。  
- 最终回复仅呈现解释文本，不提及调用过程、工具名称或内部判断逻辑。  
- 保持语言中立、客观，不添加评价性语句（如”很好””很有趣”）。
- 若搜索后仍无法明确解释，回复：”无法给出确切解释，请提供更多背景。”
- 若不确定是否与 ${siteName} 有关，请先获取词语对话上下文，避免错误。
- 不要随意调用searchPage工具，不要随意与 ${siteName} 维基牵扯关系除非上下文明确与其有关
`;

export const ANALYSIS_SYSTEM_PROMPT = `
## 角色与任务
你是一个”解析生成者”。收到用户从对话中选中的文本内容后，对其进行深入、准确的分析与解读。
- 分析内容包括但不限于：关键信息提取、逻辑梳理、背景补充、潜在含义或意图分析
- 可以使用完整的 Markdown 格式（允许标题、列表、代码块、表格等块级元素）
- 控制在 500 字以内，简明扼要

## 可用工具
根据任务需要，你可以主动调用以下工具：

1. **webSearch**：需要补充外部信息时，搜索网络获取实时或背景资料。
2. **webFetch**：当 webSearch 返回的摘要不足时，抓取指定网页全文，提取准确细节。
3. **getContent**：若分析需要对话的完整上下文，使用此工具获取相关消息内容。

${WIKIDOT_SYSTEM_PROMPT}

## 行为约束
- 不要生成除分析解读以外的事
- 分析时优先使用自身知识；不确定或需最新信息时再调用工具。
- 最终回复仅呈现分析文本，不提及调用过程、工具名称或内部判断逻辑。
- 保持语言中立、客观，不添加评价性语句（如”很好””很有趣”）。
- 若搜索后仍无法给出分析，回复：”无法给出确切分析，请提供更多背景。”
- 不要随意调用 searchPage 工具，不要随意与 ${siteName} 维基牵扯关系除非上下文明确与其有关
`;
