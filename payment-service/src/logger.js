// Logging for the payment service: the shared pino logger, plus httpLogger(),
// which app.js mounts to write one JSON line per request. Prometheus scrapes
// aren't logged: they go to the metrics port (metricsApp.js), which doesn't mount it.
// Same format as the bookstore's logs (only "service" differs), so in
// CloudWatch you can search both services' logs the same way.
//
// Why pino: one JSON object per line on stdout, and OpenTelemetry can later
// add trace_id/span_id to these lines automatically.

const pino = require('pino');
const pinoHttp = require('pino-http');
const { loadConfig } = require('./config');
const { routeLabel, statusLabel } = require('./metrics');

const logger = pino({
  level: loadConfig().logLevel, // tests set LOG_LEVEL=silent
  base: { service: 'payment-service' },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// The fields of each request line. Built when the response finishes, so the
// route pattern is known. See app/src/middleware/requestLogger.js for details.
function fields(req, res, val) {
  return { method: req.method, route: routeLabel(req, res), status: statusLabel(res), durationMs: val.responseTime };
}

function httpLogger() {
  return pinoHttp({
    logger,
    quietReqLogger: true, // don't dump every request header into the log
    quietResLogger: true,
    customLogLevel: (req, res, err) => {
      const status = statusLabel(res);
      if (err || status >= 500) return 'error';
      if (status >= 400) return 'warn';
      return 'info';
    },
    customSuccessObject: (req, res, val) => fields(req, res, val),
    // Note the extra "err" argument: pino-http passes (req, res, err, val) here.
    customErrorObject: (req, res, err, val) => fields(req, res, val),
    customSuccessMessage: (req, res) => (res.writableFinished ? 'request completed' : 'request aborted by client'),
    customErrorMessage: () => 'request failed',
  });
}

module.exports = { logger, httpLogger };
