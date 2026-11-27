// Tests for the REAL payment client (src/clients/paymentClient.js): that it
// classifies each kind of failure correctly and records the
// payment_client_request_duration_seconds metric.
//
// Instead of the real payment service, each test starts a tiny stand-in HTTP
// server on 127.0.0.1 that answers however the test needs. Nothing leaves
// this machine.
process.env.LOG_LEVEL = 'silent';

const http = require('node:http');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentClient, PaymentError } = require('../src/clients/paymentClient');
const { createMetrics } = require('../src/metrics');
const { logger } = require('../src/logger');

let stub;

// Starts a stand-in payment service that runs `handler` for every request.
async function startStub(handler) {
  stub = http.createServer(handler);
  stub.listen(0, '127.0.0.1');
  await new Promise((resolve) => stub.once('listening', resolve));
  return `http://127.0.0.1:${stub.address().port}`;
}

afterEach(async () => {
  if (stub) {
    stub.closeAllConnections();
    await new Promise((resolve) => stub.close(resolve));
    stub = undefined;
  }
});

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function makeClient(baseUrl, timeoutMs = 2000) {
  const metrics = createMetrics();
  return { metrics, client: createPaymentClient({ baseUrl, timeoutMs, metrics, logger }) };
}

const PAYMENT = { amount: 10, bookId: 1, quantity: 1 };

async function outcomeOf(promise) {
  const err = await promise.then(() => null, (e) => e);
  assert.ok(err instanceof PaymentError, `expected a PaymentError, got ${err}`);
  return err.outcome;
}

test('approved: sends the payment as JSON and returns paymentId and status', async () => {
  let received;
  const baseUrl = await startStub((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      received = { method: req.method, url: req.url, body: JSON.parse(data) };
      reply(res, 201, { paymentId: 'abc', status: 'approved' });
    });
  });
  const { client, metrics } = makeClient(baseUrl);

  assert.deepEqual(await client.charge(PAYMENT), { paymentId: 'abc', status: 'approved' });
  assert.deepEqual(received, { method: 'POST', url: '/payments', body: PAYMENT });

  const text = await metrics.registry.metrics();
  assert.match(text, /payment_client_request_duration_seconds_count\{outcome="approved"\} 1/);
  assert.match(text, /payment_client_request_duration_seconds_bucket\{le="0.3",outcome="approved"\}/);
});

test('5xx from the payment service -> outcome "error"', async () => {
  const baseUrl = await startStub((req, res) => reply(res, 500, { error: 'boom' }));
  const { client, metrics } = makeClient(baseUrl);

  assert.equal(await outcomeOf(client.charge(PAYMENT)), 'error');
  assert.match(await metrics.registry.metrics(), /payment_client_request_duration_seconds_count\{outcome="error"\} 1/);
});

test('nothing listening on the port -> outcome "unreachable"', async () => {
  // Start a server to get a free port, then close it so the port refuses connections.
  const baseUrl = await startStub(() => {});
  await new Promise((resolve) => stub.close(resolve));
  stub = undefined;
  const { client, metrics } = makeClient(baseUrl);

  assert.equal(await outcomeOf(client.charge(PAYMENT)), 'unreachable');
  assert.match(await metrics.registry.metrics(), /payment_client_request_duration_seconds_count\{outcome="unreachable"\} 1/);
});

test('slower than the timeout -> outcome "timeout"', async () => {
  const baseUrl = await startStub((req, res) => {
    setTimeout(() => reply(res, 201, { paymentId: 'late', status: 'approved' }), 500);
  });
  const { client, metrics } = makeClient(baseUrl, 100);

  assert.equal(await outcomeOf(client.charge(PAYMENT)), 'timeout');
  assert.match(await metrics.registry.metrics(), /payment_client_request_duration_seconds_count\{outcome="timeout"\} 1/);
});
