import db from './db.js';
import { createOpenAIClient, THINKING_ENABLED } from './config.js';

// ─── Query helpers ─────────────────────────────────────────────────────────────

export function getConversation(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function getBranchMessages(conversationId, branchId) {
  return db.prepare(`
    SELECT id, role, content, created_at FROM messages
    WHERE conversation_id = ? AND branch_id = ?
    ORDER BY id ASC
  `).all(conversationId, branchId);
}

export function annotateMessages(convId, activeBranchId, messages) {
  const nameMap = {};
  const allBranches = db.prepare('SELECT id, name FROM branches WHERE conversation_id = ?').all(convId);
  for (const b of allBranches) nameMap[b.id] = b.name;

  for (const msg of messages) {
    const siblings = db.prepare(`
      SELECT DISTINCT m.branch_id
      FROM messages m
      WHERE m.conversation_id = ? AND m.created_at = ? AND m.role = ? AND m.branch_id != ?
    `).all(convId, msg.created_at, msg.role, activeBranchId);

    if (siblings.length > 0) {
      const branches = [{ branch_id: activeBranchId, name: nameMap[activeBranchId] || 'current' }];
      for (const s of siblings) {
        branches.push({ branch_id: s.branch_id, name: nameMap[s.branch_id] || '?' });
      }
      msg.shared_branches = branches;
    }
  }
  return messages;
}

// ─── API helpers ───────────────────────────────────────────────────────────────

export function buildApiMessages(conv, branchId) {
  const all = getBranchMessages(conv.id, branchId);
  const sys = all.filter(m => m.role === 'system');
  const chat = all.filter(m => m.role !== 'system');
  const sysText = sys.length > 0 ? sys.map(m => m.content).join('\n\n') : conv.system_prompt;
  const msgs = [{ role: 'system', content: sysText }];
  for (const m of chat) msgs.push({ role: m.role, content: m.content });
  return msgs;
}

export async function callDeepSeek(conv, messages) {
  const openai = createOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: conv.model, messages,
    temperature: conv.temperature, max_tokens: conv.max_tokens, top_p: conv.top_p,
    reasoning_effort: conv.reasoning_effort || 'high',
    extra_body: { thinking: THINKING_ENABLED },
  });
  return {
    content: completion.choices[0].message.content,
    reasoning_content: completion.choices[0].message.reasoning_content || null,
  };
}
