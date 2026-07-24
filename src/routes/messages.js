import { Router } from 'express';
import db from '../db.js';
import { getConversation, buildApiMessages, callDeepSeek } from '../helpers.js';
import { SCP_SYSTEM_PROMPT, runToolLoop } from '../tools/index.js';

const router = Router();

// ─── Edit message (creates new branch) ─────────────────────────────────────────

router.put('/:id/messages/:msgId', async (req, res) => {
  try {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.msgId, conv.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const { content } = req.body;
    const oldBranchId = conv.active_branch_id;
    const isUser = msg.role === 'user';

    // Copy messages before the edit point
    const prevMsgs = db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? AND branch_id = ? AND id < ? ORDER BY id ASC
    `).all(conv.id, oldBranchId, req.params.msgId);

    // New branch
    const suffix = isUser ? `edit-user-${req.params.msgId}` : `edit-ai-${req.params.msgId}`;
    const bi = db.prepare('INSERT INTO branches (conversation_id, parent_branch_id, name) VALUES (?,?,?)')
      .run(conv.id, oldBranchId, suffix);
    const newBid = Number(bi.lastInsertRowid);

    for (const pm of prevMsgs) {
      db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content, reasoning_content, created_at) VALUES (?,?,?,?,?,?)')
        .run(conv.id, newBid, pm.role, pm.content, pm.reasoning_content || null, pm.created_at);
    }

    // Insert the edited message
    const ei = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(conv.id, newBid, msg.role, content);
    const newMsgId = Number(ei.lastInsertRowid);

    let aiResponse = null;

    // If editing user message → auto call DeepSeek
    if (isUser) {
      const apiMsgs = buildApiMessages(conv, newBid);
      if (apiMsgs.length > 0 && apiMsgs[0].role === 'system') {
        apiMsgs[0].content += SCP_SYSTEM_PROMPT;
      }
      const result = await callDeepSeek(conv, apiMsgs);
      const aiInfo = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
        .run(conv.id, newBid, 'assistant', result.content);
      aiResponse = { messageId: Number(aiInfo.lastInsertRowid), content: result.content, reasoning_content: result.reasoning_content };
    }

    // Switch to new branch
    db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(newBid, conv.id);

    const newBranch = db.prepare('SELECT * FROM branches WHERE id = ?').get(newBid);

    res.json({ success: true, branch: newBranch, newMsgId, aiResponse });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Regenerate last assistant message (SSE streaming) ──────────────────────────

router.post('/:id/regenerate', async (req, res) => {
  try {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const branchId = conv.active_branch_id;

    // Delete last assistant message
    const last = db.prepare(`
      SELECT id FROM messages WHERE conversation_id = ? AND branch_id = ? AND role = 'assistant'
      ORDER BY id DESC LIMIT 1
    `).get(conv.id, branchId);
    if (last) db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);

    const apiMsgs = buildApiMessages(conv, branchId);
    if (apiMsgs.length > 0 && apiMsgs[0].role === 'system') {
      apiMsgs[0].content += SCP_SYSTEM_PROMPT;
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

    for await (const event of runToolLoop(conv, apiMsgs)) {
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

export default router;
