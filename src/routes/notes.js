import { Router } from "express";
import * as convService from "../services/conversation.service.js";
import * as messageService from "../services/message.service.js";
import * as noteService from "../services/note.service.js";
import { runNoteToolLoop, NOTE_SYSTEM_PROMPT, ANALYSIS_SYSTEM_PROMPT } from "../tools/note/index.js";

const router = Router();

// ── SSE helpers ──

function setupSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── GET /api/notes/:id ──

router.get('/:id', async (req, res) => {
  try {
    const note = await noteService.get(req.params.id);
    if (!note) return res.status(404).json({ error: 'Not found' });
    res.json(note);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/notes ── create note + stream AI generation ──

router.post('/', async (req, res) => {
  try {
    const { message_id, start_from, length, note, form = 'note' } = req.body;

    const msg = messageService.get(message_id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const conv = convService.get(msg.conversation_id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // insert note skeleton (content generated below)
    const newNote = await noteService.insert(message_id, length, start_from, note, null, null, form);

    const systemPrompt = form === 'analysis' ? ANALYSIS_SYSTEM_PROMPT : NOTE_SYSTEM_PROMPT;
    const messages = [
      { role: 'system', content: systemPrompt + `\n\n## 上下文\n当前用户选中的文本所在消息 ID 为 ${message_id}。如需获取该消息的完整上下文，请调用 getContent 工具并传入此 ID。` },
      { role: 'user', content: note },
    ];

    setupSSE(res);

    let fullContent = '', fullReasoning = '';

    for await (const event of runNoteToolLoop(conv, messages)) {
      if (event.type === 'reasoning_delta') {
        fullReasoning += event.content;
        sendSSE(res, { reasoning_delta: event.content });
      } else if (event.type === 'delta') {
        fullContent += event.content;
        sendSSE(res, { delta: event.content });
      } else if (event.type === 'tool_call') {
        sendSSE(res, { tool_call: { name: event.name, args: event.args } });
      } else if (event.type === 'done') {
        if (!fullContent) fullContent = event.content;
        if (!fullReasoning) fullReasoning = event.reasoning_content || '';
      }
    }

    // persist AI content
    const updated = await noteService.update(newNote.id, fullContent, fullReasoning);
    sendSSE(res, { done: true, note: updated });

    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else { try { sendSSE(res, { error: e.message }); res.end(); } catch {} }
  }
});

export default router;
