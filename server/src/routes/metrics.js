import express from 'express';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();

/**
 * GET /metrics
 * Get current metrics snapshot
 */
router.get('/', (req, res) => {
  const metrics = metricsCollector.getMetrics();
  res.json(metrics);
});

/**
 * GET /metrics/:endpoint
 * Get metrics for specific endpoint
 */
router.get('/:endpoint', (req, res) => {
  const metrics = metricsCollector.getEndpointMetrics(req.params.endpoint);
  res.json(metrics);
});

export default router;
