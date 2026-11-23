// Writes one JSON log line per request (access log), using pino-http.
// Mounted in app.js right after requestMetrics.
//
// Example line:
// {"level":"info","time":"...","service":"bookstore","reqId":1,"method":"GET",
//  "route":"/books/:id","status":200,"durationMs":3,"msg":"request completed"}
//
// Why customSuccessObject/customErrorObject build the fields: they run when the
// response finishes, after Express has matched the route, so "route" is the
// pattern. (pino-http's customProps also runs at the start, when it isn't.)
// quietReqLogger/quietResLogger stop pino-http from dumping full request and
// response objects (all headers) into every line.
//
// Levels: 5xx -> error, 4xx -> warn, else info. Stack traces for unexpected
// errors are logged by middleware/errorHandler.js, not here.
// If the caller hangs up before we answer, status is 499 (see requestLabels.js).

const pinoHttp = require('pino-http');
const { logger } = require('../logger');
const { routeLabel, statusLabel } = require('../requestLabels');

function fields(req, res, val) {
  return {
    method: req.method,
    route: routeLabel(req, res),
    status: statusLabel(res),
    durationMs: val.responseTime,
  };
}

function requestLogger() {
  return pinoHttp({
    logger,
    quietReqLogger: true,
    quietResLogger: true,
    // Same rule as the metrics: Prometheus scrapes are not logged.
    autoLogging: { ignore: (req) => req.url === '/metrics' },
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

module.exports = { requestLogger };
