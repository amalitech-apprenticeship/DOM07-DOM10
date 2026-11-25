// Entry point for "npm start" and the Docker image: reads config and starts two
// listeners. Tests never load this file; they call createApp() and
// createMetricsApp() directly.
//
//   PORT          (4000) the service: POST /payments, /health
//   METRICS_PORT  (9464) GET /metrics only, for Prometheus (see metricsApp.js)
//
// Both share ONE metrics registry, so the metrics port reports the service's requests.
const http = require('node:http');
const { createApp } = require('./app');
const { createMetricsApp } = require('./metricsApp');
const { loadConfig } = require('./config');
const { logger } = require('./logger');

const config = loadConfig();
const app = createApp({ config });
const metricsApp = createMetricsApp(app.locals.metricsRegistry);

// If EITHER listener can't start (e.g. port already in use), log it and exit
// non-zero. Running without the metrics port would go unnoticed: a health
// check only looks at /health on the main port, and Prometheus would just see
// a target that's down, with no clue why.
function listen(name, server, port, host, fields = {}) {
  server.once('error', (err) => {
    logger.fatal({ err, port }, `${name} failed to listen on ${port}`);
    process.exit(1);
  });
  server.once('listening', () => logger.info({ port, ...fields }, `${name} listening on ${port}`));
  return server.listen(port, host);
}

// Logging the fault settings at startup makes it obvious from the logs
// alone whether a slow or failing period was caused on purpose.
// The service port keeps Node's default address (all interfaces), as before.
const appServer = listen('app', http.createServer(app), config.port, undefined, {
  delayMs: config.delayMs,
  delayJitterMs: config.delayJitterMs,
  failureRate: config.failureRate,
});
// 0.0.0.0, not 127.0.0.1: inside a container, Docker can only publish a port
// that listens on all interfaces. Who may reach it is decided by the security group.
const metricsServer = listen('metrics', http.createServer(metricsApp), config.metricsPort, '0.0.0.0');

// docker stop sends SIGTERM: stop accepting requests on both listeners, let
// in-flight ones finish, then exit.
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return; // a second Ctrl+C while waiting changes nothing
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await Promise.all([closeServer(appServer), closeServer(metricsServer)]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
