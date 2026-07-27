import express from "express"
const app = express();
app.use(express.json());

const VALID_KEY = 'sk-your-key-here';

// function auth(req, res, next) {
//     const authHeader = req.headers.authorization || '';
//     const token = authHeader.replace('Bearer ', '');
//     if (token !== VALID_KEY) {
//         return res.status(401).json({ error: { message: 'Invalid API key' } });
//     }
//     next();
// }

// app.use(auth);

// 模型列表
app.get('/v1/models', (req, res) => {
    res.json({
        object: 'list',
        data: [
            { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
            { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
        ],
    });
});

// 解析思考模式配置
function parseThinkingConfig(body) {
    // 1. OpenAI 格式：thinking.type === "enabled"
    const thinkingEnabled = body?.thinking?.type === 'enabled';
    // 2. Anthropic 格式：output_config.effort 存在
    const effort = body?.output_config?.effort || body?.reasoning_effort || null;

    let isThinking = thinkingEnabled || !!effort;
    let thinkingEffort = 'high'; // 默认

    if (effort) {
        // 映射 effort 值：low/medium -> high, xhigh -> max
        const e = effort.toLowerCase();
        if (e === 'low' || e === 'medium') thinkingEffort = 'high';
        else if (e === 'xhigh') thinkingEffort = 'max';
        else thinkingEffort = e; // high / max
    }

    return { isThinking, effort: thinkingEffort };
}

// 对话补全（支持流式与非流式）
app.post('/v1/chat/completions', (req, res) => {
    const { model, messages, stream = false } = req.body;
    const { isThinking, effort } = parseThinkingConfig(req.body);

    // 模拟回复文本
    const lastUserMsg = messages?.filter(m => m.role === 'user').pop()?.content || '';
    let reasoningText = '';
    let answerText = '';

    if (isThinking) {
        // 模拟思维链内容（根据 effort 调整长度）
        const steps = effort === 'max'
            ? ['666', '尝66666666666asdvgasdgghvd vhagvdywad.', 'wuiybghahbrgybksjhbyugvwjaskbhgfvr', 'ssssssssss']
            : ['sss', 'asdfghjkl;wertyuiodfvgbnmfghjfghj', 'ssssssssssssssssssssssssssssssssssssssss'];
        reasoningText = steps.join('\n') + `\n\n(思考强度: ${effort})`;
        answerText = `sssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss`;
    } else {
        answerText = `;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;ssssssssssssssss`;
    }

    if (!stream) {
        // 非流式响应
        const response = {
            id: 'mock-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: answerText,
                    ...(isThinking && { reasoning_content: reasoningText }),
                },
                finish_reason: 'stop',
            }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: (reasoningText.length + answerText.length),
                total_tokens: 10 + reasoningText.length + answerText.length,
            },
        };
        return res.json(response);
    }

    // ── 流式响应 (SSE) ──
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const streamId = 'mock-stream-' + Date.now();
    const created = Math.floor(Date.now() / 1000);

    // 如果有思考内容，先推送 reasoning_content 流
    let phase = isThinking ? 'reasoning' : 'content';
    let charIndex = 0;
    const reasoningChars = isThinking ? reasoningText.split('') : [];
    const answerChars = answerText.split('');

    function sendChunk(deltaField, deltaValue, finishReason = null) {
        const chunk = {
            id: streamId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
                index: 0,
                delta: {
                    [deltaField]: deltaValue,
                },
                finish_reason: finishReason,
            }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    const interval = setInterval(() => {
        if (phase === 'reasoning') {
            if (charIndex < reasoningChars.length) {
                sendChunk('reasoning_content', reasoningChars[charIndex]);
                charIndex++;
            } else {
                // 思维链发送完毕，切换到 content 阶段
                phase = 'content';
                charIndex = 0;
                // 可选：发送一个空的 reasoning_content 表示结束（非必须）
                // sendChunk('reasoning_content', ''); // 有些客户端期待一个空值表示切换
            }
        } else if (phase === 'content') {
            if (charIndex < answerChars.length) {
                sendChunk('content', answerChars[charIndex]);
                charIndex++;
            } else {
                // 发送结束标记
                sendChunk('content', '', 'stop');
                res.write('data: [DONE]\n\n');
                clearInterval(interval);
                res.end();
            }
        }
    }, 30); // 每 30ms 发送一个字符，模拟真实流
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🔧 模拟 DeepSeek V4 API 运行在 http://localhost:${PORT}`);
    console.log(`👉 使用 key: ${VALID_KEY}`);
    console.log(`🧠 支持思考模式参数 (thinking.type / output_config.effort / reasoning_effort)`);
});