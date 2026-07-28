import db from './db.js';

export function getBranchMessages(conversationId, branchId) {
  return db.prepare(`
    SELECT id, role, content, reasoning_content, tool_calls, created_at FROM messages
    WHERE conversation_id = ? AND branch_id = ?
    ORDER BY id ASC
  `).all(conversationId, branchId);
}

export function buildApiMessages(conv, branchId) {
  const all = getBranchMessages(conv.id, branchId);
  const sys = all.filter(m => m.role === 'system');
  const chat = all.filter(m => m.role !== 'system');
  const sysText = sys.length > 0 ? sys.map(m => m.content).join('\n\n') : conv.system_prompt;
  const msgs = [{ role: 'system', content: sysText }];
  for (const m of chat) msgs.push({ role: m.role, content: m.content });
  return msgs;
}
