// Configuration from environment variables, with defaults.
// Used by server.js, store.js, logger.js and app.js (for the payment client).
// Read when called (not at require time) so tests can set env vars first.

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    dbPath: env.DB_PATH || './data/bookstore.db',
    // Where the payment service lives. In Docker this is the payment
    // container's name on the shared network, e.g. http://payment-service:4000.
    paymentUrl: (env.PAYMENT_URL || 'http://localhost:4000').replace(/\/+$/, ''),
    // How long an order waits for the payment service before giving up (504).
    paymentTimeoutMs: positiveNumber(env.PAYMENT_TIMEOUT_MS, 2000),
    // "silent" in tests, "debug" when investigating, "info" otherwise.
    logLevel: env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig };
