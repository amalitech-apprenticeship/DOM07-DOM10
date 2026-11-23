// Entry point for "npm start" and the Docker image: reads config and starts
// listening. Tests never load this file; they call createApp() directly.
const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { logger } = require('./logger');

const config = loadConfig();
const app = createApp({ config });

const server = app.listen(config.port, () => {
  // Logging the fault settings at startup makes it obvious from the logs
  // alone whether a slow or failing period was caused on purpose.
  logger.info(
    {
      port: config.port,
      delayMs: config.delayMs,
      delayJitterMs: config.delayJitterMs,
      failureRate: config.failureRate,
    },
    `Payment service running at http://localhost:${config.port}`
  );
});

// docker stop sends SIGTERM: stop accepting requests, finish the current ones, exit.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
