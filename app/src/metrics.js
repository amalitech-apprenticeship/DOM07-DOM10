// Prometheus registry and metric definitions for the bookstore.
// app.js creates one set per app; middleware/requestMetrics.js records the
// http_* metrics, clients/paymentClient.js records the payment metric, and
// routes/metrics.js serves them all at GET /metrics.
//
// DO NOT rename metrics, labels or buckets: Grafana dashboards and alert
// rules query these exact names.
//
// Why a dedicated registry (not prom-client's global one): every app instance,
// e.g. one per test, gets its own independent counters.

const promClient = require('prom-client');

// Same buckets everywhere (bookstore, payment client, payment service), so
// latency panels are comparable. 0.3 is there because the latency alert is 300 ms.
const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5];

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
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  // How long the bookstore waited for the payment service, seen from the
  // bookstore's side. Compare with the payment service's own
  // http_request_duration_seconds to see time lost on the network.
  // outcome: approved | error | timeout | unreachable
  const paymentClientDuration = new promClient.Histogram({
    name: 'payment_client_request_duration_seconds',
    help: 'Duration of calls from the bookstore to the payment service, in seconds',
    labelNames: ['outcome'],
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  return { registry, requestsTotal, requestDuration, paymentClientDuration };
}

module.exports = { createMetrics, DURATION_BUCKETS };
