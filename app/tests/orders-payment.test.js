// Tests for the payment step of POST /orders. A FAKE payment client is
// injected into createApp, so there are no network calls: each test decides
// whether the "payment service" approves or fails, and how.
process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMetricsApp } = require('../src/metricsApp');
const { approvedPaymentClient, failingPaymentClient } = require('./helpers/fakePaymentClient');

let app;
let server;
let baseUrl;

// Unlike app.test.js, each test starts its own app, because each one needs
// a different fake payment client.
async function start(paymentClient) {
  app = createApp({ paymentClient });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  app.locals.store.close();
});

function postOrder(body) {
  return fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getStock(bookId) {
  return (await (await fetch(`${baseUrl}/books/${bookId}`)).json()).stock;
}

async function getOrders() {
  return (await fetch(`${baseUrl}/orders`)).json();
}

test('approved payment: charges the order total, then creates the order', async () => {
  const payments = approvedPaymentClient();
  await start(payments);

  const res = await postOrder({ bookId: 2, quantity: 3 });
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.total, 113.97);

  // Exactly one charge, for the same amount as the order total.
  assert.deepEqual(payments.calls, [{ amount: 113.97, bookId: 2, quantity: 3 }]);
  assert.equal(await getStock(2), 0);
  assert.deepEqual(await getOrders(), [order]);
});

// Each failure outcome from the client maps to its own 5xx status.
for (const [outcome, status, message] of [
  ['error', 502, /failed to process/],
  ['unreachable', 503, /unavailable/],
  ['timeout', 504, /timed out/],
]) {
  test(`payment ${outcome} -> ${status}, and stock and orders are unchanged`, async () => {
    const payments = failingPaymentClient(outcome);
    await start(payments);
    const stockBefore = await getStock(1);

    const res = await postOrder({ bookId: 1, quantity: 2 });
    assert.equal(res.status, status);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['error']);
    assert.match(body.error, message);

    assert.equal(payments.calls.length, 1, 'payment was attempted');
    assert.equal(await getStock(1), stockBefore);
    assert.deepEqual(await getOrders(), []);
  });
}

test('payment failures are counted in http metrics with their 5xx status', async () => {
  await start(failingPaymentClient('timeout'));
  await postOrder({ bookId: 1, quantity: 1 });

  // Metrics live on the metrics-only app, which shares the main app's registry.
  const metricsServer = createMetricsApp(app.locals.metricsRegistry).listen(0);
  await new Promise((resolve) => metricsServer.once('listening', resolve));
  const text = await (await fetch(`http://127.0.0.1:${metricsServer.address().port}/metrics`)).text();
  await new Promise((resolve) => metricsServer.close(resolve));
  assert.match(text, /http_requests_total\{method="POST",route="\/orders",status="504"\} 1/);
});

test('the payment service is not called when the order is invalid or out of stock', async () => {
  const payments = approvedPaymentClient();
  await start(payments);

  assert.equal((await postOrder({ bookId: 1, quantity: 0 })).status, 400);
  assert.equal((await postOrder({ bookId: 999, quantity: 1 })).status, 404);
  assert.equal((await postOrder({ bookId: 5, quantity: 1 })).status, 409); // book 5 is sold out
  assert.equal(payments.calls.length, 0);
});

test('a non-payment bug in the client still becomes a 500, not a 502', async () => {
  await start({
    async charge() {
      throw new TypeError('bug in the client');
    },
  });
  const res = await postOrder({ bookId: 1, quantity: 1 });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Internal server error' });
  assert.deepEqual(await getOrders(), []);
});
