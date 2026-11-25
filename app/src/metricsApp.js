// The metrics-only listener: a second, tiny Express app that serves GET /metrics
// and nothing else. server.js runs it on METRICS_PORT (default 9464), separate
// from the public port, so a security group can open it to the monitoring
// server only. The public app no longer has a /metrics route at all.
//
// createMetricsApp(registry) takes the registry the main app already created
// (app.locals.metricsRegistry), so a scrape shows the main app's request
// metrics, not an empty registry of its own. Tests call it the same way.
//
// Deliberately NO requestMetrics or requestLogger middleware here: Prometheus
// scrapes every ~15 s, and counting or logging those would drown out real traffic.

const express = require('express');
const { notFound } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');

function createMetricsApp(registry) {
  const app = express();

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  // Every other path: the same JSON 404 (and JSON 500) as the main app.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createMetricsApp };
