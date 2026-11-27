// Last stop for any error thrown (or passed to next(err)) in a route.
// Mounted last in app.js. Express 5 also forwards errors from async handlers here.
//
// Turns errors into the API's usual { "error": "..." } JSON:
//  - malformed JSON body          -> 400
//  - errors with a 4xx err.status -> that status and message (e.g. the store's
//    409 when stock runs out inside the order transaction)
//  - anything else                -> 500, with the stack trace logged.
//    The client never sees the stack, only "Internal server error".

const { logger } = require('../logger');

// "next" is unused, but must stay: Express recognises an error handler by its 4 arguments.
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON' });
  }
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  // pino's "err" key prints type, message and stack as JSON fields.
  logger.error({ err, method: req.method, path: req.path }, 'unexpected error');
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
