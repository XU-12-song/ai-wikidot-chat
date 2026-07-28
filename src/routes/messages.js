import { Router } from 'express';
import * as convService from '../services/conversation.service.js';
import * as chatService from '../services/chat.service.js';
import * as messageService from '../services/message.service.js';
import { runToolLoop } from '../tools/index.js';

const router = Router();

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

// ── Edit message (creates branch, optionally streams AI response) ──

router.put('/:id/messages/:msgId', async (req, res) => {
  try {
    const conv = convService.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const result = messageService.edit(conv.id, req.params.msgId, req.body.content, conv.active_branch_id);
    if (!result) return res.status(404).json({ error: 'Message not found' });

    // editing AI message → just return branch info
    if (!result.isUser) {
      return res.json({ success: true, branch: result.branch, newMsgId: result.newMsgId, aiResponse: null });
    }

    // editing user message → stream AI response
    const updatedConv = convService.get(conv.id);
    const apiMessages = chatService.getApiMessages(updatedConv, result.newBid);

    setupSSE(res);

    let fullContent = '', fullReasoning = '', toolsCalled = [];

    for await (const event of runToolLoop(updatedConv, apiMessages)) {
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
      const msgId = chatService.saveAssistantMessage(updatedConv.id, result.newBid, fullContent, fullReasoning, toolsCalled);
      sendSSE(res, { done: true, messageId: msgId, fullContent, reasoning_content: fullReasoning || null, tool_calls: toolsCalled });
    }

    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else { try { sendSSE(res, { error: e.message }); res.end(); } catch {} }
  }
});

// ── Regenerate last assistant message ──

router.post('/:id/regenerate', async (req, res) => {
  try {
    const conv = convService.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const branchId = conv.active_branch_id;
    chatService.deleteLastAssistant(conv.id, branchId);

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

export default router;
