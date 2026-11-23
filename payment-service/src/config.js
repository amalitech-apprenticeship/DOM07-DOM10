// Configuration from environment variables, with defaults. Used by server.js
// (and by logger.js for LOG_LEVEL). Tests pass their own config to createApp
// instead, so they don't need to change process.env.
//
// The PAYMENT_* settings are fault injection: they let you make this service
// slow or failing on purpose, to test the bookstore's dashboards and alerts.
// They are all "off" by default. They are read once at startup, so changing
// them means restarting the container (see README.md).

// Turns an env var into a number, falling back to the default if it's missing
// or not a number, and keeping it within [min, max].
function number(value, fallback, min, max = Infinity) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function loadConfig(env = process.env) {
  return {
    port: number(env.PORT, 4000, 1, 65535),
    // Fixed extra delay added to every payment, in ms.
    delayMs: number(env.PAYMENT_DELAY_MS, 0, 0),
    // Random extra delay between 0 and this many ms, on top of delayMs.
    // Makes latency spread out like real traffic instead of one flat line.
    delayJitterMs: number(env.PAYMENT_DELAY_JITTER_MS, 0, 0),
    // Fraction of payments (0 to 1) that fail with a 500. 0.1 = about 1 in 10.
    failureRate: number(env.PAYMENT_FAILURE_RATE, 0, 0, 1),
    logLevel: env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig };
