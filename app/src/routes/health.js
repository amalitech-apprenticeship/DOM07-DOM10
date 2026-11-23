// GET /health: a quick "is the process alive?" check. Used by the frontend's
// status badge and by scripts/deploy.sh after a deploy.
// It deliberately does NOT call the payment service: if payments are down, the
// bookstore is still up (books still list), and a deploy shouldn't fail because of it.

const express = require('express');

function healthRoutes() {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  return router;
}

module.exports = { healthRoutes };
