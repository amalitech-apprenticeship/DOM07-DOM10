// Read-only book catalog: GET /books and GET /books/:id. Used by the frontend
// to show the list and stock. All data access goes through the store.

const express = require('express');

function bookRoutes({ store }) {
  const router = express.Router();

  router.get('/books', (req, res) => {
    res.json(store.listBooks());
  });

  router.get('/books/:id', (req, res) => {
    const book = store.findBook(Number(req.params.id));
    if (!book) return res.status(404).json({ error: `Book ${req.params.id} not found` });
    res.json(book);
  });

  return router;
}

module.exports = { bookRoutes };
