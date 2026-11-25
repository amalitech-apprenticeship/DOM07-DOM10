// Records http_requests_total and http_request_duration_seconds for every
// request. Mounted first in app.js so the timer covers all the work.
//
// Why on "close" (not "finish"): "close" fires once for EVERY request, both
// after a normal response and when the caller disconnects before we answered.
// "finish" only fires for the first case, so slow requests whose caller
// timed out would silently disappear from the latency metrics. Those are
// labelled status="499" (see requestLabels.js). By then we also know which
// route matched, for the "/books/:id" label.
//
// Prometheus scrapes never reach this middleware: they go to the separate
// metrics port (metricsApp.js), which doesn't mount it. A GET /metrics on the
// public port is an ordinary 404 and is counted like one (route="not_found").

const { routeLabel, statusLabel } = require('../requestLabels');

function requestMetrics(metrics) {
  return (req, res, next) => {
    const endTimer = metrics.requestDuration.startTimer();
    res.once('close', () => {
      const labels = { method: req.method, route: routeLabel(req, res), status: String(statusLabel(res)) };
      metrics.requestsTotal.inc(labels);
      endTimer(labels);
    });
    next();
  };
}

module.exports = { requestMetrics };
