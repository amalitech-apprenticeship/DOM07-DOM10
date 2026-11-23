// Tests for the payment service. Each test builds an app with its own config
// (no env vars needed) and talks to it over HTTP on a random free port.
process.env.LOG_LEVEL = 'silent'; // must be set before the app is loaded

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const NO_FAULTS = { delayMs: 0, delayJitterMs: 0, failureRate: 0 };

let server;
let baseUrl;

async function start(config = NO_FAULTS, random) {
  const app = createApp({ config: { ...NO_FAULTS, ...config }, random });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  server.closeAllConnections(); // don't wait for idle keep-alive connections
  await new Promise((resolve) => server.close(resolve));
});

function pay(body) {
  return fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const PAYMENT = { amount: 85, bookId: 1, quantity: 2 };

test('GET /health reports ok', async () => {
  await start();
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('POST /payments approves a valid payment with a unique paymentId', async () => {
  await start();
  const first = await pay(PAYMENT);
  assert.equal(first.status, 201);
  const body = await first.json();
  assert.equal(body.status, 'approved');
  assert.equal(typeof body.paymentId, 'string');
  assert.ok(body.paymentId.length > 0);

  const second = await (await pay(PAYMENT)).json();
  assert.notEqual(second.paymentId, body.paymentId);
});

test('POST /payments returns 400 for an invalid body', async () => {
  await start();
  for (const body of [
    {},
    { ...PAYMENT, amount: 0 },
    { ...PAYMENT, amount: '85' },
    { ...PAYMENT, bookId: 1.5 },
    { ...PAYMENT, quantity: 0 },
  ]) {
    const res = await pay(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
  assert.equal((await pay('{not json')).status, 400);
});

test('PAYMENT_FAILURE_RATE=1 fails every payment with a 500', async () => {
  await start({ failureRate: 1 });
  for (let i = 0; i < 20; i++) {
    const res = await pay(PAYMENT);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /simulated failure/);
  }
});

test('PAYMENT_FAILURE_RATE=0 never fails', async () => {
  await start({ failureRate: 0 });
  for (let i = 0; i < 20; i++) {
    assert.equal((await pay(PAYMENT)).status, 201);
  }
});

test('a fractional failure rate fails when the random draw is below it', async () => {
  // A fake "random" that returns 0.2, then 0.8, then 0.2, ...
  const draws = [0.2, 0.8];
  let i = 0;
  await start({ failureRate: 0.5 }, () => draws[i++ % draws.length]);
  assert.equal((await pay(PAYMENT)).status, 500); // 0.2 < 0.5
  assert.equal((await pay(PAYMENT)).status, 201); // 0.8 >= 0.5
});

test('PAYMENT_DELAY_MS slows every payment down', async () => {
  await start({ delayMs: 200 });
  const started = performance.now();
  assert.equal((await pay(PAYMENT)).status, 201);
  assert.ok(performance.now() - started >= 190, 'took at least the configured delay');
});

test('a caller that times out is still counted, as status 499', async () => {
  // Like the bookstore giving up during a PAYMENT_DELAY_MS test.
  await start({ delayMs: 300 });
  await assert.rejects(
    fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PAYMENT),
      signal: AbortSignal.timeout(50),
    }),
    { name: 'TimeoutError' }
  );

  const text = await (await fetch(`${baseUrl}/metrics`)).text();
  assert.match(text, /http_requests_total\{method="POST",route="\/payments",status="499"\} 1/);
  assert.match(text, /http_request_duration_seconds_count\{method="POST",route="\/payments",status="499"\} 1/);
  assert.doesNotMatch(text, /route="\/payments",status="200"/, 'not mislabelled as a 200');
});

test('GET /metrics exposes the same http metrics as the bookstore', async () => {
  await start({ failureRate: 1 });
  await pay(PAYMENT);
  await fetch(`${baseUrl}/metrics`); // scrapes are not counted

  const res = await fetch(`${baseUrl}/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  assert.match(text, /http_requests_total\{method="POST",route="\/payments",status="500"\} 1/);
  assert.match(text, /http_request_duration_seconds_count\{method="POST",route="\/payments",status="500"\} 1/);
  for (const le of ['0.01', '0.05', '0.1', '0.3', '0.5', '1', '2', '5', '\\+Inf']) {
    assert.match(text, new RegExp(`http_request_duration_seconds_bucket\\{le="${le}",method="POST"`), `bucket ${le}`);
  }
  assert.doesNotMatch(text, /route="\/metrics"/);
});
