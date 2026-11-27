// The metrics-only listener: a second, tiny Express app that serves GET /metrics
// and nothing else. server.js runs it on METRICS_PORT (default 9464), separate
// from the service port (4000), so a security group can open it to the
// monitoring server only. The main app no longer has a /metrics route.
//
// createMetricsApp(registry) takes the registry the main app already created
// (app.locals.metricsRegistry), so a scrape shows the main app's request
// metrics, not an empty registry of its own. Tests call it the same way.
//
// Deliberately NO requestMetrics or httpLogger middleware here: Prometheus
// scrapes every ~15 s, and counting or logging those would drown out real traffic.

const express = require('express');
const { logger } = require('./logger');

function createMetricsApp(registry) {
  const app = express();

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  // Every other path: the same JSON 404 as the main app.
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // "next" must stay: Express recognises error handlers by their 4 arguments.
  app.use((err, req, res, next) => {
    logger.error({ err, method: req.method, path: req.path }, 'unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createMetricsApp };
