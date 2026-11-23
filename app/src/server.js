// Entry point for "npm start" (and the Docker image): creates the app and
// starts listening. Tests never load this file; they call createApp() directly.
const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { logger } = require('./logger');

const config = loadConfig();
const app = createApp({ config });

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, dbPath: config.dbPath, paymentUrl: config.paymentUrl, paymentTimeoutMs: config.paymentTimeoutMs },
    `Bookstore running at http://localhost:${config.port}`
  );
});

// Close the HTTP server and the database cleanly on Ctrl+C or a stop signal
// (docker stop sends SIGTERM).
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    app.locals.store.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Log a crash as one JSON line with its stack before exiting, so it shows up
// in CloudWatch like everything else (instead of a raw multi-line stack trace).
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
