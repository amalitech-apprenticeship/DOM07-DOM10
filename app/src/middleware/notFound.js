// Catch-all for requests no route or static file matched. Mounted in app.js
// after all routes. Unknown API routes get JSON, like every other error,
// instead of Express's default HTML page.

function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

module.exports = { notFound };
