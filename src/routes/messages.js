import { Router } from 'express';
import db from '../db.js';
import { getConversation, buildApiMessages, callDeepSeek } from '../helpers.js';

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
      db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content, created_at) VALUES (?,?,?,?,?)')
        .run(conv.id, newBid, pm.role, pm.content, pm.created_at);
    }

    // Insert the edited message
    const ei = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(conv.id, newBid, msg.role, content);
    const newMsgId = Number(ei.lastInsertRowid);

    let aiResponse = null;

    // If editing user message → auto call DeepSeek
    if (isUser) {
      const apiMsgs = buildApiMessages(conv, newBid);
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

// ─── Regenerate last assistant message ─────────────────────────────────────────

router.post('/:id/regenerate', async (req, res) => {
  try {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const branchId = conv.active_branch_id;

    const last = db.prepare(`
      SELECT id FROM messages WHERE conversation_id = ? AND branch_id = ? AND role = 'assistant'
      ORDER BY id DESC LIMIT 1
    `).get(conv.id, branchId);
    if (last) db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);

    const apiMsgs = buildApiMessages(conv, branchId);
    const result = await callDeepSeek(conv, apiMsgs);
    const info = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(conv.id, branchId, 'assistant', result.content);

    res.json({ messageId: Number(info.lastInsertRowid), content: result.content, reasoning_content: result.reasoning_content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
