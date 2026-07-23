import { Router } from 'express';
import db from '../db.js';
import { getConversation, getBranchMessages, annotateMessages } from '../helpers.js';

const router = Router();

function respond(res, fn) {
  try { res.json(fn()); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

router.post('/', (req, res) => {
  respond(res, () => {
    db.exec('BEGIN');
    const { title, model, temperature, max_tokens, top_p, system_prompt, reasoning_effort } = req.body;
    const info = db.prepare(`
      INSERT INTO conversations (title, model, temperature, max_tokens, top_p, system_prompt, reasoning_effort)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title || 'New Chat', model || 'deepseek-v4-pro',
           temperature ?? 0.7, max_tokens ?? 4096, top_p ?? 1.0,
           system_prompt || 'You are a helpful assistant.',
           reasoning_effort || 'high');
    const convId = Number(info.lastInsertRowid);
    const bi = db.prepare('INSERT INTO branches (conversation_id, name) VALUES (?, ?)').run(convId, 'main');
    const branchId = Number(bi.lastInsertRowid);
    db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?').run(branchId, convId);
    if (system_prompt) {
      db.prepare('INSERT INTO messages (conversation_id, branch_id, role, content) VALUES (?,?,?,?)')
        .run(convId, branchId, 'system', system_prompt);
    }
    db.exec('COMMIT');
    return getConversation(convId);
  });
});

router.get('/', (req, res) => {
  respond(res, () => db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all());
});

router.get('/:id', (req, res) => {
  respond(res, () => {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const messages = getBranchMessages(conv.id, conv.active_branch_id);
    annotateMessages(conv.id, conv.active_branch_id, messages);
    return { ...conv, messages };
  });
});

router.delete('/:id', (req, res) => {
  respond(res, () => {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    return { success: true };
  });
});

router.put('/:id/settings', (req, res) => {
  respond(res, () => {
    const conv = getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const { model, temperature, max_tokens, top_p, system_prompt, reasoning_effort } = req.body;
    db.prepare(`UPDATE conversations SET model=?, temperature=?, max_tokens=?, top_p=?, system_prompt=?, reasoning_effort=? WHERE id=?`)
      .run(model || conv.model, temperature ?? conv.temperature, max_tokens ?? conv.max_tokens,
           top_p ?? conv.top_p, system_prompt || conv.system_prompt,
           reasoning_effort || conv.reasoning_effort, req.params.id);
    return getConversation(req.params.id);
  });
});

export default router;
