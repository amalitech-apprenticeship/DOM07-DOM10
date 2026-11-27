// Builds the payment service's Express app. Used by server.js and the tests.
//
// It's a FAKE payment processor: it never moves money, it just approves
// payments (unless fault injection says otherwise) and hands back an id.
// The bookstore calls POST /payments while placing an order.
//
// createApp({ config, random }): tests pass their own config (e.g.
// failureRate: 1) and, if needed, a predictable random function.

const crypto = require('node:crypto');
const express = require('express');
const { loadConfig } = require('./config');
const { logger, httpLogger } = require('./logger');
const { createMetrics, requestMetrics } = require('./metrics');
const { createFaults, sleep } = require('./faults');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function createApp({ config = loadConfig(), random } = {}) {
  const metrics = createMetrics();
  const faults = createFaults(config, random);
  const app = express();
  // There is no /metrics route on this app: server.js serves this registry on
  // a separate metrics-only port (see metricsApp.js), so GET /metrics here is a 404.
  app.locals.metricsRegistry = metrics.registry;

  // Metrics and logs first, so they see every request and its full duration.
  app.use(requestMetrics(metrics));
  app.use(httpLogger());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  // Body: { amount: number > 0, bookId: positive int, quantity: positive int }
  // 201 { paymentId, status: "approved" }, 400 for a bad body,
  // 500 when fault injection decides this payment fails.
  app.post('/payments', async (req, res) => {
    const { amount, bookId, quantity } = req.body || {};
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (!isPositiveInteger(bookId)) {
      return res.status(400).json({ error: 'bookId must be a positive integer' });
    }
    if (!isPositiveInteger(quantity)) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    // The delay applies to failures too: real outages are often slow AND failing.
    await sleep(faults.delay());

    if (faults.shouldFail()) {
      // warn, not error: this failure is intentional, there's no bug to trace.
      // The request line that follows is logged at "error" because it's a 500.
      logger.warn({ bookId, quantity, amount }, 'simulated payment failure (PAYMENT_FAILURE_RATE)');
      return res.status(500).json({ error: 'Payment failed (simulated failure)' });
    }

    // Note: if the caller already gave up (e.g. the bookstore timed out during
    // a PAYMENT_DELAY_MS test), this still approves. That's realistic: a
    // timeout tells the caller "I don't know", not "it failed". Real systems
    // handle it with idempotency keys and reconciliation; this fake doesn't.
    const paymentId = crypto.randomUUID();
    logger.info({ paymentId, bookId, quantity, amount }, 'payment approved');
    res.status(201).json({ paymentId, status: 'approved' });
  });

  // Unknown routes: JSON 404, like the bookstore.
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // Malformed JSON -> 400; anything unexpected -> 500 with the stack in the log.
  // "next" must stay: Express recognises error handlers by their 4 arguments.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
    logger.error({ err, method: req.method, path: req.path }, 'unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
