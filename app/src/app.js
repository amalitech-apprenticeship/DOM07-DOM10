const path = require('node:path');
const express = require('express');
const promClient = require('prom-client');
const { createStore } = require('./store');

// Prometheus metrics on a dedicated registry (not the global one), so every
// app instance (e.g. one per test) has its own independent set of metrics.
function createMetrics() {
  const registry = new promClient.Registry();
  promClient.collectDefaultMetrics({ register: registry });

  const labelNames = ['method', 'route', 'status'];
  const requestsTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames,
    registers: [registry],
  });
  const requestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [registry],
  });

  return { registry, requestsTotal, requestDuration };
}

// Route PATTERN label (e.g. "/books/:id"), never the raw URL, to keep cardinality low.
function routeLabel(req, res) {
  if (req.route) return req.baseUrl + req.route.path;
  if (res.locals.servedStatic) return 'static';
  if (res.statusCode === 404) return 'not_found';
  return 'unmatched'; // no route matched but not a 404, e.g. a malformed JSON body (400)
}

function createApp({ store = createStore() } = {}) {
  const app = express();
  app.locals.store = store; // lets server.js and tests close the database

  const metrics = createMetrics();
  app.locals.metricsRegistry = metrics.registry;

  // Record a count and a duration for every request once the response is sent.
  // Scrapes of /metrics itself are not counted.
  app.use((req, res, next) => {
    if (req.path === '/metrics') return next();
    const endTimer = metrics.requestDuration.startTimer();
    res.on('finish', () => {
      const labels = { method: req.method, route: routeLabel(req, res), status: String(res.statusCode) };
      metrics.requestsTotal.inc(labels);
      endTimer(labels);
    });
    next();
  });

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

  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', metrics.registry.contentType);
      res.send(await metrics.registry.metrics());
    } catch (err) {
      next(err);
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.get('/books', (req, res) => {
    res.json(store.listBooks());
  });

  app.get('/books/:id', (req, res) => {
    const book = store.findBook(Number(req.params.id));
    if (!book) return res.status(404).json({ error: `Book ${req.params.id} not found` });
    res.json(book);
  });

  app.get('/orders', (req, res) => {
    res.json(store.listOrders());
  });

  app.get('/orders/:id', (req, res) => {
    const order = store.findOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
    res.json(order);
  });

  app.post('/orders', (req, res) => {
    const { bookId, quantity } = req.body || {};

    if (!Number.isInteger(bookId) || bookId < 1) {
      return res.status(400).json({ error: 'bookId must be a positive integer' });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    const book = store.findBook(bookId);
    if (!book) {
      return res.status(404).json({ error: `Book ${bookId} not found` });
    }
    if (book.stock < quantity) {
      return res.status(409).json({
        error: `Not enough stock for "${book.title}": requested ${quantity}, available ${book.stock}`,
      });
    }

    res.status(201).json(store.createOrder(book, quantity));
  });

  // Dummy endpoint for sold-out books. It always fails with a 500 on purpose,
  // so it can be used to push the server error rate up when testing monitoring
  // and alerts.
  app.post('/request-books', (req, res) => {
    const { bookId } = req.body || {};
    throw new Error(`Restock request failed for book ${bookId} (intentional error)`);
  });

  // Unknown API routes get JSON, not Express's default HTML page.
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // Malformed JSON bodies and any unexpected error.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
    // Errors the store raises on purpose, e.g. 409 if stock ran out mid-transaction.
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
// trigger test
