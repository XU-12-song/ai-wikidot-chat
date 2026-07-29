import { createOpenAIClient, THINKING_ENABLED } from '../config.js';

export function createToolExecutor(toolMap) {
  return async function (name, args) {
    const fn = toolMap[name];
    if (!fn) return JSON.stringify({ error: `未知工具: ${name}` });
    try {
      return JSON.stringify(await fn(args));
    } catch (error) {
      return JSON.stringify({ error: error.message || '工具执行出错' });
    }
  }
}

/**
 * Generic streaming tool-calling loop. Does NOT depend on any specific tool set —
 * tools and their executor are injected via options.
 *
 * Yields events in real-time as they arrive from the model:
 * - { type: 'reasoning_delta', content } — thinking/reasoning chunk
 * - { type: 'delta', content }          — response text chunk
 * - { type: 'tool_call', name, args }   — a tool was invoked by the model
 * - { type: 'done', content, reasoning_content, toolsCalled } — final answer
 *
 * @param {object} conv
 *        Conversation settings (model, temperature, max_tokens, top_p, reasoning_effort).
 * @param {Array<{role: string, content?: string, tool_calls?: Array}>} messages
 *        API-formatted message history. Will be mutated in-place (tool results appended).
 * @param {object} options
 * @param {Array<object>} options.tools
 *        OpenAI function-calling tool definitions.
 * @param {(name: string, args: object) => Promise<string>} options.executeTool
 *        Executor: receives tool name + parsed arguments, returns JSON-serialised result string.
 *        Thrown errors are caught and serialised as { error: message } automatically.
 * @param {number} [options.maxIterations=20]
 *        Maximum tool-calling rounds before forced stop.
 *
 * @returns {AsyncGenerator<{
 *   type: 'reasoning_delta'|'delta'|'tool_call'|'done',
 *   content?: string,
 *   name?: string,
 *   args?: object,
 *   reasoning_content?: string|null,
 *   toolsCalled?: string[]
 * }>}
 *
 * @example
 * for await (const event of runToolLoop(conv, messages, { tools: MY_TOOLS, executeTool })) {
 *   switch (event.type) {
 *     case 'reasoning_delta': // stream thinking
 *     case 'delta':           // stream content
 *     case 'tool_call':       // show tool chip
 *     case 'done':            // final answer
 *   }
 * }
 */
export async function* runToolLoop(conv, messages, { tools, executeTool, maxIterations = 20 }) {
  const openai = createOpenAIClient();
  const msgs = [...messages];
  const toolsCalled = [];

  for (let i = 0; i < maxIterations; i++) {
    const stream = await openai.chat.completions.create({
      model: conv.model,
      messages: msgs,
      tools,
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
    /** @type {Record<number, {id: string, name: string, arguments: string}>} */
    const toolCallMap = {};

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

    // ── Tool call round ──
    if (tcList.length > 0) {
      for (const tc of tcList) toolsCalled.push(tc.name);

      msgs.push({
        role: 'assistant',
        content: fullContent || null,
        tool_calls: tcList.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of tcList) {
        let args;
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }

        yield { type: 'tool_call', name: tc.name, args };

        let result;
        try {
          result = await executeTool(tc.name, args);
        } catch (error) {
          result = JSON.stringify({ error: error.message || 'Tool execution failed' });
        }

        msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      continue;
    }

    // ── Final answer ──
    yield {
      type: 'done',
      content: fullContent,
      reasoning_content: fullReasoning || null,
      toolsCalled: [...toolsCalled],
    };
    return;
  }

  // Max iterations exhausted
  yield {
    type: 'done',
    content: '',
    reasoning_content: null,
    toolsCalled: [...toolsCalled],
  };
}
