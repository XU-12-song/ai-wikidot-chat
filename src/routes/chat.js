import { Router } from 'express';
import db from '../db.js';
import { createOpenAIClient, THINKING_ENABLED } from '../config.js';
import { getConversation, getBranchMessages, buildApiMessages, callDeepSeek } from '../helpers.js';

const router = Router();

// ─── Streaming chat ────────────────────────────────────────────────────────────

router.post('/:id/chat', async (req, res) => {
  try {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { message } = req.body;
    const branchId = conv.active_branch_id;

    db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(conv.id, branchId, 'user', message);

    const chatMsgs = getBranchMessages(conv.id, branchId).filter(m => m.role !== 'system');
    if (chatMsgs.filter(m => m.role === 'user').length === 1) {
      const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conv.id);
    }

    const apiMessages = buildApiMessages(conv, branchId);
    const openai = createOpenAIClient();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let fullContent = '';
    let fullReasoning = '';
    let assistantMsgId = null;

    const stream = await openai.chat.completions.create({
      model: conv.model, messages: apiMessages,
      temperature: conv.temperature, max_tokens: conv.max_tokens, top_p: conv.top_p,
      reasoning_effort: conv.reasoning_effort || 'high',
      extra_body: { thinking: THINKING_ENABLED },
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning_content || '';
      if (reasoningDelta) {
        fullReasoning += reasoningDelta;
        res.write(`data: ${JSON.stringify({ reasoning: reasoningDelta, reasoning_content: fullReasoning })}\n\n`);
      }
      if (delta) {
        fullContent += delta;
        if (!assistantMsgId) {
          const info = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
            .run(conv.id, branchId, 'assistant', delta);
          assistantMsgId = Number(info.lastInsertRowid);
        } else {
          db.prepare('UPDATE messages SET content = content || ? WHERE id = ?').run(delta, assistantMsgId);
        }
        res.write(`data: ${JSON.stringify({ delta, content: fullContent })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, messageId: assistantMsgId, fullContent, reasoning_content: fullReasoning || null })}\n\n`);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); }
  }
});

// ─── Sync chat (fallback) ──────────────────────────────────────────────────────

router.post('/:id/chat-sync', async (req, res) => {
  try {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { message } = req.body;
    const branchId = conv.active_branch_id;

    db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(conv.id, branchId, 'user', message);

    const chatMsgs = getBranchMessages(conv.id, branchId).filter(m => m.role !== 'system');
    if (chatMsgs.filter(m => m.role === 'user').length === 1) {
      const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conv.id);
    }

    const apiMessages = buildApiMessages(conv, branchId);
    const result = await callDeepSeek(conv, apiMessages);
    const info = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(conv.id, branchId, 'assistant', result.content);

    res.json({ messageId: Number(info.lastInsertRowid), content: result.content, reasoning_content: result.reasoning_content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
