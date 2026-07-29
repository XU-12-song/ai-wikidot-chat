import { WEB_TOOL_DEFINITIONS, webSearch, webFetch } from '../web.tool.js';
import { getContent } from './content.js';
import { createToolExecutor, runToolLoop } from '../tool-loop.js';

// ─── Note tool definitions ────────────────────────────────────────────────────

/** @type {Array<object>} OpenAI function-calling tool definitions for note generation */
export const NOTE_TOOL_DEFINITIONS = [
    ...WEB_TOOL_DEFINITIONS,
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
你是一个“小记生成者”。收到用户提供的词汇后，用简洁、准确的语言对其进行解释。  
- 必须使用**行内 Markdown 格式**（仅限加粗、斜体、\`代码\`、[链接]() 等，不得出现标题、列表、代码块、表格等块级元素）。  
- 严格控制在 **300 字以内**，不得超限。

## 可用工具
根据任务需要，你可以主动调用以下工具（仅需说明去向，不得在最终回复中暴露工具名称）：

1. **webSearch**：需要补充外部信息时，搜索网络获取实时或背景资料。  
2. **webFetch**：当 webSearch 返回的摘要不足时，抓取指定网页全文，提取准确细节。  
3. **getContent**：若用户词汇在当前对话上下文中有特殊含义，使用此工具提取相关上下文，确保解释贴合当前主题。

## 行为约束
- 解释时优先使用自身知识；不确定或需最新信息时再调用工具。  
- 最终回复仅呈现解释文本，不提及调用过程、工具名称或内部判断逻辑。  
- 保持语言中立、客观，不添加评价性语句（如“很好”“很有趣”）。  
- 若搜索后仍无法明确解释，回复：“无法给出确切解释，请提供更多背景。”

`;
