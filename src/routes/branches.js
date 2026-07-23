import { Router } from 'express';
import db from '../db.js';
import { getConversation, getBranchMessages } from '../helpers.js';

const router = Router();

function respond(res, fn) {
  try { res.json(fn()); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

router.get('/:id/branches', (req, res) => {
  respond(res, () => {
    return db.prepare(`
      SELECT b.*, (SELECT COUNT(*) FROM messages WHERE branch_id = b.id) AS msg_count
      FROM branches b WHERE b.conversation_id = ? ORDER BY b.created_at ASC
    `).all(req.params.id);
  });
});

router.post('/:id/branches', (req, res) => {
  respond(res, () => {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const { name } = req.body;
    const info = db.prepare('INSERT INTO branches (conversation_id, parent_branch_id, name) VALUES (?,?,?)')
      .run(conv.id, conv.active_branch_id, name || `branch-${Date.now()}`);
    const newBid = Number(info.lastInsertRowid);
    const msgs = getBranchMessages(conv.id, conv.active_branch_id);
    for (const m of msgs) {
      db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content, created_at) VALUES (?,?,?,?,?)')
        .run(conv.id, newBid, m.role, m.content, m.created_at);
    }
    db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(newBid, conv.id);
    return db.prepare('SELECT * FROM branches WHERE id = ?').get(newBid);
  });
});

router.put('/:id/branches/switch', (req, res) => {
  respond(res, () => {
    const { branchId } = req.body;
    db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(branchId, req.params.id);
    return db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  });
});

export default router;
