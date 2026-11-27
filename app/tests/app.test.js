// Use an in-memory SQLite database so tests never touch a real file.
// Must be set before the app (and its store) is loaded.
process.env.DB_PATH = ':memory:';
// No log output during tests. Must also be set before the app is loaded.
process.env.LOG_LEVEL = 'silent';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMetricsApp } = require('../src/metricsApp');
const { approvedPaymentClient } = require('./helpers/fakePaymentClient');

// Each test gets a fresh app with its own freshly seeded in-memory database,
// listening on a random free port. Payments always succeed here, through a
// fake client with no network calls; payment failures are covered in
// orders-payment.test.js.
// Like server.js, a metrics-only app shares the main app's registry and gets
// its own random port (metricsUrl).
let app;
let server;
let baseUrl;
let metricsServer;
let metricsUrl;

function listenOnFreePort(expressApp) {
  const srv = expressApp.listen(0);
  return new Promise((resolve) => srv.once('listening', () => resolve(srv)));
}

beforeEach(async () => {
  app = createApp({ paymentClient: approvedPaymentClient() });
  server = await listenOnFreePort(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  metricsServer = await listenOnFreePort(createMetricsApp(app.locals.metricsRegistry));
  metricsUrl = `http://127.0.0.1:${metricsServer.address().port}`;
});

afterEach(async () => {
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => metricsServer.close(resolve)),
  ]);
  app.locals.store.close();
});

// The lines of http_requests_total in a scrape, e.g.
// 'http_requests_total{method="GET",route="/books/:id",status="200"} 1'.
async function requestCounterLines() {
  const text = await (await fetch(`${metricsUrl}/metrics`)).text();
  return text.split('\n').filter((line) => line.startsWith('http_requests_total{'));
}

function postOrder(body) {
  return fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('GET / returns the frontend HTML page', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<title>Bookstore<\/title>/);
  assert.match(html, /<script src="app.js"><\/script>/);
});

test('GET /health reports ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('GET /books lists books with title, author, price and stock', async () => {
  const res = await fetch(`${baseUrl}/books`);
  assert.equal(res.status, 200);
  const books = await res.json();
  assert.ok(books.length > 0);
  for (const book of books) {
    assert.equal(typeof book.title, 'string');
    assert.equal(typeof book.author, 'string');
    assert.equal(typeof book.price, 'number');
    assert.equal(typeof book.stock, 'number');
  }
  assert.equal(books.length, 5);
  assert.ok(books.some((b) => b.stock === 0), 'seed includes a sold-out book');
});

test('GET /books/:id returns one book', async () => {
  const res = await fetch(`${baseUrl}/books/2`);
  assert.equal(res.status, 200);
  const book = await res.json();
  assert.equal(book.id, 2);
  assert.equal(book.title, 'Clean Code');
});

test('GET /books/:id returns 404 for an unknown or invalid id', async () => {
  for (const id of ['999', 'abc']) {
    const res = await fetch(`${baseUrl}/books/${id}`);
    assert.equal(res.status, 404, id);
    assert.match((await res.json()).error, /not found/);
  }
});

test('GET /orders/:id returns a created order', async () => {
  const created = await (await postOrder({ bookId: 3, quantity: 2 })).json();

  const res = await fetch(`${baseUrl}/orders/${created.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), created);

  const all = await (await fetch(`${baseUrl}/orders`)).json();
  assert.deepEqual(all, [created]);
});

test('GET /orders/:id returns 404 for an unknown or invalid id', async () => {
  for (const id of ['1', '999', 'abc']) {
    const res = await fetch(`${baseUrl}/orders/${id}`);
    assert.equal(res.status, 404, id);
    assert.match((await res.json()).error, /not found/);
  }
});

test('POST /orders creates an order and decrements stock', async () => {
  const res = await postOrder({ bookId: 1, quantity: 2 });
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.bookId, 1);
  assert.equal(order.quantity, 2);
  assert.equal(order.total, 85);

  const book = await (await fetch(`${baseUrl}/books/1`)).json();
  assert.equal(book.stock, 3);
});

test('POST /orders returns 400 for invalid input', async () => {
  for (const body of [{ bookId: 1 }, { bookId: 1, quantity: 0 }, { bookId: 1, quantity: 1.5 }, { quantity: 1 }]) {
    const res = await postOrder(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
  const malformed = await postOrder('{not json');
  assert.equal(malformed.status, 400);
});

test('POST /orders returns 404 for an unknown book', async () => {
  const res = await postOrder({ bookId: 999, quantity: 1 });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /not found/);
});

test('POST /orders returns 409 when stock is insufficient', async () => {
  const res = await postOrder({ bookId: 2, quantity: 50 });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Not enough stock/);

  // A rejected order changes nothing.
  const book = await (await fetch(`${baseUrl}/books/2`)).json();
  assert.equal(book.stock, 3);
  const orders = await (await fetch(`${baseUrl}/orders`)).json();
  assert.equal(orders.length, 0);
});

test('POST /request-books always fails with 500 (intentional dummy error)', async () => {
  const res = await fetch(`${baseUrl}/request-books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId: 1 }),
  });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Internal server error' });
});

test('GET /metrics on the main app is a normal JSON 404', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Route GET /metrics not found' });
});

test('metrics app: GET /metrics exposes Prometheus metrics', async () => {
  const res = await fetch(`${metricsUrl}/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain; version=0\.0\.4/);
  const text = await res.text();
  assert.match(text, /http_requests_total/);
  assert.match(text, /http_request_duration_seconds/);
});

test('metrics app: every other path is a JSON 404', async () => {
  for (const [method, path] of [['GET', '/'], ['GET', '/health'], ['GET', '/books'], ['POST', '/metrics']]) {
    const res = await fetch(`${metricsUrl}${path}`, { method });
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: `Route ${method} ${path} not found` });
  }
});

test("metrics app shows the main app's requests, by route pattern (shared registry)", async () => {
  await fetch(`${baseUrl}/books/1`);
  await fetch(`${baseUrl}/metrics`); // a probe on the public port: counted as a 404

  const text = await (await fetch(`${metricsUrl}/metrics`)).text();
  assert.match(text, /http_requests_total\{method="GET",route="\/books\/:id",status="200"\} 1/);
  assert.match(text, /http_request_duration_seconds_count\{method="GET",route="\/books\/:id",status="200"\} 1/);
  assert.match(text, /http_requests_total\{method="GET",route="not_found",status="404"\} 1/);
  assert.doesNotMatch(text, /route="\/books\/1"/);
});

test('requests to the metrics app are not counted in http_requests_total', async () => {
  await fetch(`${baseUrl}/books`);
  const before = await requestCounterLines();

  for (const path of ['/metrics', '/metrics', '/nope']) await fetch(`${metricsUrl}${path}`);

  assert.deepEqual(await requestCounterLines(), before);
  assert.deepEqual(before, ['http_requests_total{method="GET",route="/books",status="200"} 1']);
});
