// Prometheus metrics for the payment service: the registry, the http metrics,
// and the middleware that records them. Used by app.js; served at GET /metrics.
//
// These are deliberately IDENTICAL to the bookstore's (app/src/metrics.js):
// same names, labels and buckets. That way one Grafana panel or alert rule
// works for both services, filtered by Prometheus's "job" label.
// It's a copy rather than a shared package so this service stays
// self-contained (its own package.json and Docker build).

const promClient = require('prom-client');

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5];

function createMetrics() {
  const registry = new promClient.Registry(); // one per app, so tests don't share counters
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
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  return { registry, requestsTotal, requestDuration };
}

// Route PATTERN, never the raw URL, to keep the number of time series small.
function routeLabel(req, res) {
  if (req.route) return req.baseUrl + req.route.path;
  if (res.statusCode === 404) return 'not_found';
  return 'unmatched'; // e.g. a malformed JSON body (400)
}

// The response status, or 499 ("client closed request", nginx's convention)
// if the caller hung up before we answered. That happens when the bookstore
// times out during a PAYMENT_DELAY_MS test. It's 4xx on purpose: the caller
// gave up, so it isn't this service's error (the bookstore counts its 504).
function statusLabel(res) {
  return res.writableFinished ? res.statusCode : 499;
}

// Counts and times every request except scrapes of /metrics itself.
// Why "close" and not "finish": "close" fires for every request, including
// ones whose caller disconnected. With "finish", exactly the slow requests
// you're testing with PAYMENT_DELAY_MS would vanish from the latency metrics.
function requestMetrics(metrics) {
  return (req, res, next) => {
    if (req.path === '/metrics') return next();
    const endTimer = metrics.requestDuration.startTimer();
    res.once('close', () => {
      const labels = { method: req.method, route: routeLabel(req, res), status: String(statusLabel(res)) };
      metrics.requestsTotal.inc(labels);
      endTimer(labels);
    });
    next();
  };
}

module.exports = { createMetrics, requestMetrics, routeLabel, statusLabel };
