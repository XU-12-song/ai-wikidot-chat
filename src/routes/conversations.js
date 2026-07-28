import { Router } from 'express';
import * as convService from '../services/conversation.service.js';

const router = Router();

router.post('/', (req, res) => {
  const conv = convService.create(req.body);
  res.json(conv);
});

router.get('/', (req, res) => {
  res.json(convService.list());
});

router.get('/:id', (req, res) => {
  const result = convService.getWithMessages(req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

router.delete('/:id', (req, res) => {
  convService.remove(req.params.id);
  res.json({ success: true });
});

router.put('/:id/settings', (req, res) => {
  const conv = convService.updateSettings(req.params.id, req.body);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

export default router;
