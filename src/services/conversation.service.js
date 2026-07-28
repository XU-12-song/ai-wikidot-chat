import db from '../db.js';

export function get(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function list() {
  return db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all();
}

export function create(data) {
  const { title, model, temperature, max_tokens, top_p, system_prompt, reasoning_effort } = data;

  db.exec('BEGIN');
  const info = db.prepare(`
    INSERT INTO conversations (title, model, temperature, max_tokens, top_p, system_prompt, reasoning_effort)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    title || 'New Chat',
    model || 'deepseek-v4-pro',
    temperature ?? 0.7,
    max_tokens ?? 4096,
    top_p ?? 1.0,
    system_prompt || 'You are a helpful assistant.',
    reasoning_effort || 'high'
  );
  const convId = Number(info.lastInsertRowid);

  const bi = db.prepare('INSERT INTO branches (conversation_id, name) VALUES (?, ?)').run(convId, 'main');
  const branchId = Number(bi.lastInsertRowid);

  db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(branchId, convId);

  if (system_prompt) {
    db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
      .run(convId, branchId, 'system', system_prompt);
  }
  db.exec('COMMIT');

  return get(convId);
}

export function remove(id) {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  return true;
}

export function updateSettings(id, data) {
  const conv = get(id);
  if (!conv) return null;

  const { model, temperature, max_tokens, top_p, system_prompt, reasoning_effort } = data;
  db.prepare(`
    UPDATE conversations
    SET model=?, temperature=?, max_tokens=?, top_p=?, system_prompt=?, reasoning_effort=?
    WHERE id=?
  `).run(
    model || conv.model,
    temperature ?? conv.temperature,
    max_tokens ?? conv.max_tokens,
    top_p ?? conv.top_p,
    system_prompt || conv.system_prompt,
    reasoning_effort || conv.reasoning_effort,
    id
  );
  return get(id);
}

export function getWithMessages(id) {
  const conv = get(id);
  if (!conv) return null;

  const messages = db.prepare(`
    SELECT id, role, content, reasoning_content, tool_calls, created_at FROM messages
    WHERE conversation_id = ? AND branch_id = ?
    ORDER BY id ASC
  `).all(id, conv.active_branch_id);

  // annotate: shared branches + notes
  const nameMap = {};
  const allBranches = db.prepare('SELECT id, name FROM branches WHERE conversation_id = ?').all(id);
  for (const b of allBranches) nameMap[b.id] = b.name;

  for (const msg of messages) {
    const siblings = db.prepare(`
      SELECT DISTINCT m.branch_id
      FROM messages m
      WHERE m.conversation_id = ? AND m.created_at = ? AND m.role = ? AND m.branch_id != ?
    `).all(id, msg.created_at, msg.role, conv.active_branch_id);

    if (siblings.length > 0) {
      const branches = [{ branch_id: conv.active_branch_id, name: nameMap[conv.active_branch_id] || 'current' }];
      for (const s of siblings) {
        branches.push({ branch_id: s.branch_id, name: nameMap[s.branch_id] || '?' });
      }
      msg.shared_branches = branches;
    }

    msg.notes = db.prepare('SELECT * FROM notes WHERE message_id = ?').all(msg.id);
  }

  return { ...conv, messages };
}
