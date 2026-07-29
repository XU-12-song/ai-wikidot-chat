import db from '../pool.js';

export function get(id) {
  return db.prepare('SELECT * FROM messages m WHERE m.id = ?').get(id);
}

export function edit(convId, msgId, content, activeBranchId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(msgId, convId);
  if (!msg) return null;

  const isUser = msg.role === 'user';

  // copy messages before the edit point
  const prevMsgs = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND branch_id = ? AND id < ?
    ORDER BY id ASC
  `).all(convId, activeBranchId, msgId);

  // create new branch
  const suffix = isUser ? `edit-user-${msgId}` : `edit-ai-${msgId}`;
  const bi = db.prepare('INSERT INTO branches (conversation_id, parent_branch_id, name) VALUES (?,?,?)')
    .run(convId, activeBranchId, suffix);
  const newBid = Number(bi.lastInsertRowid);

  const insert = db.prepare(
    'INSERT INTO messages (conversation_id, branch_id, role, content, reasoning_content, created_at) VALUES (?,?,?,?,?,?)'
  );
  for (const pm of prevMsgs) {
    insert.run(convId, newBid, pm.role, pm.content, pm.reasoning_content || null, pm.created_at);
  }

  // insert the edited message
  const ei = db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
    .run(convId, newBid, msg.role, content);
  const newMsgId = Number(ei.lastInsertRowid);

  // switch to new branch
  db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(newBid, convId);

  return {
    newBid,
    newMsgId,
    isUser,
    branch: db.prepare('SELECT * FROM branches WHERE id = ?').get(newBid),
  };
}
