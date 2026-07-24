import { Router } from 'express';
import db from '../db.js';
import { getConversation, getBranchMessages, buildApiMessages, callDeepSeek } from '../helpers.js';
import { SCP_SYSTEM_PROMPT, runToolLoop } from '../tools/index.js';

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
    if (apiMessages.length > 0 && apiMessages[0].role === 'system') {
      apiMessages[0].content += SCP_SYSTEM_PROMPT;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    let fullContent = '';
    let fullReasoning = '';
    let toolsCalled = [];

    for await (const event of runToolLoop(conv, apiMessages)) {
      if (event.type === 'tool_call') {
        res.write(`data: ${JSON.stringify({ tool_call: { name: event.name, args: event.args } })}\n\n`);
      } else if (event.type === 'delta') {
        fullContent += event.content;
        res.write(`data: ${JSON.stringify({ delta: event.content })}\n\n`);
      } else if (event.type === 'reasoning_delta') {
        fullReasoning += event.content;
        res.write(`data: ${JSON.stringify({ reasoning_delta: event.content })}\n\n`);
      } else if (event.type === 'done') {
        if (!fullContent) fullContent = event.content;
        if (!fullReasoning) fullReasoning = event.reasoning_content || '';
        if (event.toolsCalled) toolsCalled = event.toolsCalled;
      }
    }

    if (fullContent || fullReasoning || toolsCalled.length > 0) {
      const toolCallsJson = toolsCalled.length > 0 ? JSON.stringify(toolsCalled) : null;
      const info = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content, reasoning_content, tool_calls) VALUES (?,?,?,?,?,?)')
        .run(conv.id, branchId, 'assistant', fullContent, fullReasoning || null, toolCallsJson);
      const assistantMsgId = Number(info.lastInsertRowid);
      res.write(`data: ${JSON.stringify({ done: true, messageId: assistantMsgId, fullContent, reasoning_content: fullReasoning || null, tool_calls: toolsCalled })}\n\n`);
    }

    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else { try { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); } catch {} }
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
    if (apiMessages.length > 0 && apiMessages[0].role === 'system') {
      apiMessages[0].content += SCP_SYSTEM_PROMPT;
    }

    let fullContent = '';
    let fullReasoning = null;
    let toolsCalled = [];
    for await (const event of runToolLoop(conv, apiMessages)) {
      if (event.type === 'done') {
        fullContent = event.content;
        fullReasoning = event.reasoning_content;
        if (event.toolsCalled) toolsCalled = event.toolsCalled;
      }
    }

    const toolCallsJson = toolsCalled.length > 0 ? JSON.stringify(toolsCalled) : null;
    const info = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content, reasoning_content, tool_calls) VALUES (?,?,?,?,?,?)')
      .run(conv.id, branchId, 'assistant', fullContent, fullReasoning, toolCallsJson);

    res.json({ messageId: Number(info.lastInsertRowid), content: fullContent, reasoning_content: fullReasoning, tool_calls: toolsCalled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
