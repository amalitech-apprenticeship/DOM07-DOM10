# Payment Service

A tiny, **fake** payment processor for the bookstore (`../app`). It never moves
money. It approves payments and returns an id, unless you tell it to be slow or
to fail. That's what it's for: making realistic latency and errors on demand, so
you can test dashboards, alerts and (later) distributed tracing.

Node 22 + Express. No database. The http metrics and the JSON logs have the same
format as the bookstore's.

## Quick start

```bash
npm install
npm start          # http://localhost:4000, metrics on :9464
npm run dev        # restarts on file changes
npm test           # Node's built-in test runner, no extra test packages
```

To run it together with the bookstore, use `docker compose up -d --build` from
the repo root (see `../docker-compose.yml`). If you run both with `npm start`
on one machine instead, start this one with `METRICS_PORT=9465`: both default
to 9464, and the second one to start would exit.

## Ports

| Port | Served by | Who should be able to reach it |
| ---- | --------- | ------------------------------ |
| `4000` (`PORT`) | The service: `POST /payments`, `/health` | Only the bookstore, over the Docker network. Not published. |
| `9464` (`METRICS_PORT`) | Metrics only: `GET /metrics`, every other path is a JSON 404 | The monitoring server only (security group). docker compose and the EC2 host publish it as **9465**, because the bookstore already uses host port 9464. |

`GET /metrics` on port 4000 is an ordinary 404. Both listeners share one
metrics registry, so the metrics port reports the service's requests.
Requests to the metrics port are not counted in the http metrics and not logged.

**If either port can't be opened** (for example, it's already in use), the
process logs a `fatal` line and exits with code 1. It never runs without its
metrics port, because a health check only looks at `/health` on port 4000 and
wouldn't notice.

## API

These are on the service port (4000). `/metrics` is on the metrics port; see [Metrics](#metrics).

| Method | Path        | Response |
| ------ | ----------- | -------- |
| POST   | `/payments` | `201 { "paymentId": "3f2c…", "status": "approved" }` |
| GET    | `/health`   | `{ "status": "ok", "uptime": 12 }` |

`POST /payments` body:

```json
{ "amount": 85, "bookId": 1, "quantity": 2 }
```

| Status | When |
| ------ | ---- |
| 201 | Approved. `paymentId` is a random UUID. |
| 400 | `amount` isn't a positive number, `bookId`/`quantity` aren't positive integers, or the body isn't JSON |
| 500 | Simulated failure (see `PAYMENT_FAILURE_RATE`): `{ "error": "Payment failed (simulated failure)" }` |

## Configuration and fault injection

| Variable | Default | What it does |
| -------- | ------- | ------------ |
| `PORT` | `4000` | Port the service listens on |
| `METRICS_PORT` | `9464` | Metrics-only port (`GET /metrics`), on all interfaces (0.0.0.0) |
| `PAYMENT_DELAY_MS` | `0` | Extra delay added to **every** payment, in ms |
| `PAYMENT_DELAY_JITTER_MS` | `0` | Extra **random** delay between 0 and this value, in ms, on top of the fixed delay |
| `PAYMENT_FAILURE_RATE` | `0` | Fraction of payments (0 to 1) that fail with a 500. `0.1` ≈ 1 in 10, `1` = all |
| `LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info`, `debug` |

All fault settings default to "off". The delay also applies to payments that
fail, since real outages are often slow *and* failing. The settings are logged
at startup, so the logs show when a bad period was caused on purpose.

Example scenarios (from the repo root, with docker compose):

```bash
# ~10% of orders fail -> bookstore 502s, pushes the error rate above 5%
PAYMENT_FAILURE_RATE=0.1 docker compose up -d payment-service

# Payments take 300-500 ms -> trips a "latency > 300 ms" alert
PAYMENT_DELAY_MS=300 PAYMENT_DELAY_JITTER_MS=200 docker compose up -d payment-service

# Slower than the bookstore's 2 s timeout -> bookstore 504s
PAYMENT_DELAY_MS=3000 docker compose up -d payment-service

# Back to normal
docker compose up -d payment-service
```

PowerShell: `$env:PAYMENT_FAILURE_RATE=1; docker compose up -d payment-service`,
then `Remove-Item Env:PAYMENT_FAILURE_RATE` and run `up -d` again to go back.

### Changing a setting restarts the container, which resets its metrics

The settings are environment variables read once at startup, so changing one
means Docker **recreates the container**. A new process starts with every
counter at zero: `http_requests_total` and the histogram's `_count`, `_sum` and
`_bucket` series all drop back to 0.

That's fine as long as dashboards and alerts use `rate()` / `increase()`, which
they should anyway. Prometheus recognises a counter that goes down as a
**counter reset** and treats it as a restart, not as negative traffic. For
example:

```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
```

What you'll see: a short gap around the restart (no scrape while the container
is down), then the graph continues normally. Never graph or alert on the raw
counter value: it really does jump back to 0 after every restart.

## Metrics

`GET /metrics` on the metrics port (`METRICS_PORT`, default 9464; host port
9465 in docker compose) exposes exactly the same http metrics as the bookstore, so one
dashboard panel or alert rule works for both (tell them apart by Prometheus's
`job` / `instance` labels):

- `http_requests_total{method, route, status}`: counter
- `http_request_duration_seconds{method, route, status}`: histogram, buckets
  `[0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]`
- Node.js process metrics (`process_*`, `nodejs_*`)

`route` is the pattern (`/payments`), not the raw URL. Nothing sent to the
metrics port is counted, scrapes included. A `GET /metrics` on port 4000 is a
normal 404, counted as `route="not_found", status="404"`.

**Status 499.** With `PAYMENT_DELAY_MS` above the bookstore's 2 s timeout, the
bookstore hangs up before this service answers. Those requests are still
counted (and logged) with `status="499"`, nginx's "client closed request", so
the slow requests you're testing don't vanish from the latency histogram. 499
is 4xx, so it doesn't count toward this service's error rate. The bookstore
counts the failure on its side as a 504.

Note that the payment is still **approved** after the bookstore gave up, so the
shopper is charged with no order. That's realistic: a timeout means "unknown",
not "failed". Real systems handle it with idempotency keys and reconciliation.

## Logs

One JSON line per request on stdout, plus one line per approved or simulated-failed
payment:

```json
{"level":"info","time":"2026-11-23T10:00:00.000Z","service":"payment-service","paymentId":"3f2c…","bookId":1,"quantity":2,"amount":85,"msg":"payment approved"}
{"level":"info","time":"2026-11-23T10:00:00.001Z","service":"payment-service","reqId":1,"method":"POST","route":"/payments","status":201,"durationMs":2,"msg":"request completed"}
```

5xx request lines are logged at `error`, 4xx at `warn`. Requests to the metrics
port (Prometheus scrapes) aren't logged.

At startup it logs one line per listener (`app listening on 4000` with the
fault settings, and `metrics listening on 9464`). If either can't start, it
logs a `fatal` line and exits with code 1.

## Layout

```
src/
  server.js   entry point: reads config, starts BOTH listeners, graceful shutdown
  app.js      createApp({ config, random }): routes, 404 and error handling
  metricsApp.js  createMetricsApp(registry): the metrics-only app (GET /metrics, else 404)
  config.js   env vars -> config (PORT, METRICS_PORT, PAYMENT_*, LOG_LEVEL)
  faults.js   the delay / failure decisions (fault injection)
  metrics.js  Prometheus registry, http metrics, request-metrics middleware
  logger.js   pino logger + per-request JSON logging (pino-http)
tests/
  payments.test.js
```

## Docker

```bash
docker build -t payment-service .
docker run --rm -p 4000:4000 -p 9465:9464 -e PAYMENT_FAILURE_RATE=0.2 payment-service
```

Runs as the unprivileged `node` user. It has no volume, because it stores nothing.
