// GET /metrics: the page Prometheus scrapes. Serves everything in the app's
// registry (see metrics.js). Requests to it are not counted or logged
// (see middleware/requestMetrics.js and middleware/requestLogger.js).

const express = require('express');

function metricsRoutes({ metrics }) {
  const router = express.Router();

  router.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  return router;
}

module.exports = { metricsRoutes };
