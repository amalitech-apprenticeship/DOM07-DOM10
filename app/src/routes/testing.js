// TEST-ONLY ROUTES. Remove this file (and its one line in app.js) once the
// error-rate alert has been tested.
//
// POST /request-books is a dummy "request a restock" endpoint (the frontend
// shows it for sold-out books). It ALWAYS fails with a 500 on purpose, so you
// can push the error rate above 5% and watch the alert fire.
// For latency and dependency errors, use the payment service's
// PAYMENT_DELAY_MS / PAYMENT_FAILURE_RATE settings instead.

const express = require('express');

function testingRoutes() {
  const router = express.Router();

  router.post('/request-books', (req) => {
    const { bookId } = req.body || {};
    throw new Error(`Restock request failed for book ${bookId} (intentional error)`);
  });

  return router;
}

module.exports = { testingRoutes };
