import db from '../pool.js';
import { getBranchMessages } from '../helpers.js';

export function list(convId) {
  return db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM messages WHERE branch_id = b.id) AS msg_count
    FROM branches b
    WHERE b.conversation_id = ?
    ORDER BY b.created_at ASC
  `).all(convId);
}

export function create(convId, name) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return null;

  const info = db.prepare('INSERT INTO branches (conversation_id, parent_branch_id, name) VALUES (?,?,?)')
    .run(convId, conv.active_branch_id, name || `branch-${Date.now()}`);
  const newBid = Number(info.lastInsertRowid);

  const msgs = getBranchMessages(convId, conv.active_branch_id);
  const insert = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content, created_at) VALUES (?,?,?,?,?)');
  for (const m of msgs) {
    insert.run(convId, newBid, m.role, m.content, m.created_at);
  }

  db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(newBid, convId);
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(newBid);
}

export function switchTo(convId, branchId) {
  db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(branchId, convId);
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
}
