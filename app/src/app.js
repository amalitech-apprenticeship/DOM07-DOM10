// Builds the bookstore Express app. Used by server.js (real run) and by the
// tests. This file only WIRES things together; each piece lives in its own file.
//
// createApp({ store, paymentClient, config }): every part can be swapped out,
// so tests can pass an in-memory store and a fake payment client and never
// touch a real database file or the network.
//
// Order matters in Express. Middleware runs top to bottom:
//   metrics + logging first (so they time everything),
//   then body parsing, static files, routes,
//   then "not found" and finally the error handler.

const path = require('node:path');
const express = require('express');
const { createStore } = require('./store');
const { loadConfig } = require('./config');
const { logger } = require('./logger');
const { createMetrics } = require('./metrics');
const { createPaymentClient } = require('./clients/paymentClient');
const { requestMetrics } = require('./middleware/requestMetrics');
const { requestLogger } = require('./middleware/requestLogger');
const { notFound } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');
const { healthRoutes } = require('./routes/health');
const { bookRoutes } = require('./routes/books');
const { orderRoutes } = require('./routes/orders');
const { metricsRoutes } = require('./routes/metrics');
const { testingRoutes } = require('./routes/testing');

function createApp({ store = createStore(), paymentClient, config = loadConfig() } = {}) {
  const metrics = createMetrics();
  // The real client is only built when a test hasn't injected a fake one.
  paymentClient ??= createPaymentClient({
    baseUrl: config.paymentUrl,
    timeoutMs: config.paymentTimeoutMs,
    metrics,
    logger,
  });

  const app = express();
  app.locals.store = store; // lets server.js and tests close the database
  app.locals.metricsRegistry = metrics.registry;

  app.use(requestMetrics(metrics));
  app.use(requestLogger());
  app.use(express.json());

  // Frontend: public/index.html is served at "/", plus styles.css and app.js.
  // setHeaders only runs when a file is actually served, which marks it for the "static" label.
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      setHeaders: (res) => {
        res.locals.servedStatic = true;
      },
    })
  );

  app.use(metricsRoutes({ metrics }));
  app.use(healthRoutes());
  app.use(bookRoutes({ store }));
  app.use(orderRoutes({ store, paymentClient }));
  app.use(testingRoutes()); // TEST ROUTE: POST /request-books always fails (500). Remove after testing alerts.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
