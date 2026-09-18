import { Router } from 'express';
import { redisStatus } from '../cache';

const router = Router();

export function healthPayload() {
  return {
    status: 'ok',
    redis: redisStatus() ? 'up' : 'down',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

router.get('/', (_, res) => res.json({ status: 'ok' }));
router.get('/health', (_, res) => res.status(200).json(healthPayload()));

export default router;
