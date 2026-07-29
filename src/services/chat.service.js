import db from '../pool.js';
import { getBranchMessages, buildApiMessages } from '../helpers.js';
import { WIKIDOT_SYSTEM_PROMPT } from '../tools/index.js';

export function insertUserMessage(convId, branchId, content) {
  db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
    .run(convId, branchId, 'user', content);

  // auto-title: use first user message as title
  const chatMsgs = getBranchMessages(convId, branchId).filter(m => m.role !== 'system');
  if (chatMsgs.filter(m => m.role === 'user').length === 1) {
    const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, convId);
  }
}

export function getApiMessages(conv, branchId) {
  const msgs = buildApiMessages(conv, branchId);
  if (msgs.length > 0 && msgs[0].role === 'system') {
    msgs[0].content += WIKIDOT_SYSTEM_PROMPT;
  }
  return msgs;
}

export function saveAssistantMessage(convId, branchId, content, reasoning, toolCalls) {
  const toolCallsJson = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
  const info = db.prepare(
    'INSERT INTO messages (conversation_id, branch_id, role, content, reasoning_content, tool_calls) VALUES (?,?,?,?,?,?)'
  ).run(convId, branchId, 'assistant', content, reasoning || null, toolCallsJson);
  return Number(info.lastInsertRowid);
}

export function deleteLastAssistant(convId, branchId) {
  const last = db.prepare(`
    SELECT id FROM messages
    WHERE conversation_id = ? AND branch_id = ? AND role = 'assistant'
    ORDER BY id DESC LIMIT 1
  `).get(convId, branchId);
  if (last) db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);
}
