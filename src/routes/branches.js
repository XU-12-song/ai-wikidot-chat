import { Router } from 'express';
import * as branchService from '../services/branch.service.js';

const router = Router();

router.get('/:id/branches', (req, res) => {
  res.json(branchService.list(req.params.id));
});

router.post('/:id/branches', (req, res) => {
  const branch = branchService.create(req.params.id, req.body.name);
  if (!branch) return res.status(404).json({ error: 'Not found' });
  res.json(branch);
});

router.put('/:id/branches/switch', (req, res) => {
  const branch = branchService.switchTo(req.params.id, req.body.branchId);
  res.json(branch);
});

export default router;
