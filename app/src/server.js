// Entry point for "npm start" (and the Docker image): creates the app and
// starts two listeners. Tests never load this file; they call createApp() and
// createMetricsApp() directly.
//
//   PORT          (3000) the public app: frontend, API, /health
//   METRICS_PORT  (9464) GET /metrics only, for Prometheus (see metricsApp.js)
//
// Both share ONE metrics registry, so the metrics port reports the app's requests.
const http = require('node:http');
const { createApp } = require('./app');
const { createMetricsApp } = require('./metricsApp');
const { loadConfig } = require('./config');
const { logger } = require('./logger');

const config = loadConfig();
const app = createApp({ config });
const metricsApp = createMetricsApp(app.locals.metricsRegistry);

// If EITHER listener can't start (e.g. port already in use), log it and exit
// non-zero. Running without the metrics port would go unnoticed: deploy.sh's
// smoke test only checks /health on the main port, and Prometheus would just
// see a target that's down, with no clue why.
function listen(name, server, port, host, fields = {}) {
  server.once('error', (err) => {
    logger.fatal({ err, port }, `${name} failed to listen on ${port}`);
    process.exit(1);
  });
  server.once('listening', () => logger.info({ port, ...fields }, `${name} listening on ${port}`));
  return server.listen(port, host);
}

// The public app keeps Node's default address (all interfaces), as before.
const appServer = listen('app', http.createServer(app), config.port, undefined, {
  dbPath: config.dbPath,
  paymentUrl: config.paymentUrl,
  paymentTimeoutMs: config.paymentTimeoutMs,
});
// 0.0.0.0, not 127.0.0.1: inside a container, Docker can only publish a port
// that listens on all interfaces. Who may reach it is decided by the security group.
const metricsServer = listen('metrics', http.createServer(metricsApp), config.metricsPort, '0.0.0.0');

// On Ctrl+C or a stop signal (docker stop sends SIGTERM): stop both listeners,
// let in-flight requests finish, and close the database only after BOTH are closed.
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return; // a second Ctrl+C while waiting changes nothing
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await Promise.all([closeServer(appServer), closeServer(metricsServer)]);
  app.locals.store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Log a crash as one JSON line with its stack before exiting, so it shows up
// in CloudWatch like everything else (instead of a raw multi-line stack trace).
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
