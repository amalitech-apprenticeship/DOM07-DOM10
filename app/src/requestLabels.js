// Works out the "route" and "status" labels for a finished request.
// Used by BOTH middleware/requestMetrics.js and middleware/requestLogger.js,
// so a route in a Grafana panel and the same route in a log line always match.

// Route PATTERN, e.g. "/books/:id", never the raw URL. "/books/1",
// "/books/2", ... would each create a new Prometheus time series (high
// cardinality); the pattern keeps it to one series per route.
//
// Route files register full paths (router.get('/books/:id')) and are
// mounted at the root, so req.baseUrl is "" and req.route.path is the pattern.
function routeLabel(req, res) {
  if (req.route) return req.baseUrl + req.route.path;
  if (res.locals.servedStatic) return 'static';
  if (res.statusCode === 404) return 'not_found';
  return 'unmatched'; // no route matched but not a 404, e.g. a malformed JSON body (400)
}

// The response status, or 499 if the caller hung up before we answered
// (for example a client that timed out). 499 is nginx's "client closed request".
// Without this, such a request would be logged as a misleading 200 (Express's
// default before a status is set). It's 4xx on purpose: the caller gave up,
// so it shouldn't count toward this service's 5xx error rate.
const CLIENT_CLOSED_REQUEST = 499;

function statusLabel(res) {
  return res.writableFinished ? res.statusCode : CLIENT_CLOSED_REQUEST;
}

module.exports = { routeLabel, statusLabel };
