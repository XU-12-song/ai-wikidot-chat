import { Router } from 'express';
import * as convService from '../services/conversation.service.js';
import * as chatService from '../services/chat.service.js';
import { runToolLoop } from '../tools/index.js';

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

// ── Streaming chat ──

router.post('/:id/chat', async (req, res) => {
  try {
    const conv = convService.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { message } = req.body;
    const branchId = conv.active_branch_id;

    chatService.insertUserMessage(conv.id, branchId, message);
    const apiMessages = chatService.getApiMessages(conv, branchId);

    setupSSE(res);

    let fullContent = '', fullReasoning = '', toolsCalled = [];

    for await (const event of runToolLoop(conv, apiMessages)) {
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
        if (event.toolsCalled) toolsCalled = event.toolsCalled;
      }
    }

    if (fullContent || fullReasoning || toolsCalled.length > 0) {
      const msgId = chatService.saveAssistantMessage(conv.id, branchId, fullContent, fullReasoning, toolsCalled);
      sendSSE(res, { done: true, messageId: msgId, fullContent, reasoning_content: fullReasoning || null, tool_calls: toolsCalled });
    }

    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else { try { sendSSE(res, { error: e.message }); res.end(); } catch {} }
  }
});

// ── Sync chat ──

router.post('/:id/chat-sync', async (req, res) => {
  try {
    const conv = convService.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { message } = req.body;
    const branchId = conv.active_branch_id;

    chatService.insertUserMessage(conv.id, branchId, message);
    const apiMessages = chatService.getApiMessages(conv, branchId);

    let fullContent = '', fullReasoning = null, toolsCalled = [];
    for await (const event of runToolLoop(conv, apiMessages)) {
      if (event.type === 'done') {
        fullContent = event.content;
        fullReasoning = event.reasoning_content;
        if (event.toolsCalled) toolsCalled = event.toolsCalled;
      }
    }

    const msgId = chatService.saveAssistantMessage(conv.id, branchId, fullContent, fullReasoning, toolsCalled);
    res.json({ messageId: msgId, content: fullContent, reasoning_content: fullReasoning, tool_calls: toolsCalled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
