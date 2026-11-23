// Orders: GET /orders, GET /orders/:id, and POST /orders (place an order).
// Used by the frontend's order form.
//
// POST /orders flow:
//   1. validate the body           -> 400
//   2. find the book                -> 404
//   3. check stock                  -> 409 (before paying, so a sold-out book never costs a payment call)
//   4. charge the payment service   -> 502 / 503 / 504 if that fails
//   5. create the order (stock - quantity + insert, in one transaction)
//   6. 201 with the order
//
// Payment failures use 502/503/504, not 500, so dashboards can tell
// "a dependency failed" apart from "the bookstore itself has a bug".
// All of them are still 5xx, so the error-rate alert counts them.

const express = require('express');
const { PaymentError } = require('../clients/paymentClient');
const { logger } = require('../logger');

const PAYMENT_FAILURES = {
  error: { status: 502, message: 'Payment service failed to process the payment' },
  unreachable: { status: 503, message: 'Payment service is unavailable' },
  timeout: { status: 504, message: 'Payment service timed out' },
};

// Same rounding as the order total in store.js, so the amount charged
// always equals the total on the order.
function orderAmount(book, quantity) {
  return Math.round(book.price * quantity * 100) / 100;
}

function orderRoutes({ store, paymentClient }) {
  const router = express.Router();

  router.get('/orders', (req, res) => {
    res.json(store.listOrders());
  });

  router.get('/orders/:id', (req, res) => {
    const order = store.findOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
    res.json(order);
  });

  router.post('/orders', async (req, res) => {
    const { bookId, quantity } = req.body || {};

    if (!Number.isInteger(bookId) || bookId < 1) {
      return res.status(400).json({ error: 'bookId must be a positive integer' });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    const book = store.findBook(bookId);
    if (!book) {
      return res.status(404).json({ error: `Book ${bookId} not found` });
    }
    if (book.stock < quantity) {
      return res.status(409).json({
        error: `Not enough stock for "${book.title}": requested ${quantity}, available ${book.stock}`,
      });
    }

    let payment;
    try {
      payment = await paymentClient.charge({ amount: orderAmount(book, quantity), bookId, quantity });
    } catch (err) {
      // Anything that isn't a PaymentError is a real bug: let the error
      // handler log it with its stack and return 500.
      if (!(err instanceof PaymentError)) throw err;
      // A timeout (504) means "we don't know": the payment service may still
      // approve the payment after we gave up. A real system would send an
      // idempotency key and check later; here we just don't create the order.
      const failure = PAYMENT_FAILURES[err.outcome] || PAYMENT_FAILURES.error;
      return res.status(failure.status).json({ error: failure.message });
    }

    try {
      const order = store.createOrder(book, quantity);
      res.status(201).json(order);
    } catch (err) {
      // Rare race: another order took the last copies while we were waiting
      // for the payment. The store's transaction throws a 409 and nothing is
      // saved, but the customer HAS been charged. A real system would refund
      // the payment here (or reserve stock before paying). This project keeps
      // it simple: log the paymentId so it can be found, and return the 409.
      if (err.status === 409) {
        logger.warn({ paymentId: payment.paymentId, bookId, quantity }, 'payment approved but order failed (would refund)');
      }
      throw err; // errorHandler turns the 409 into JSON
    }
  });

  return router;
}

module.exports = { orderRoutes };
