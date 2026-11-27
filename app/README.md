# Bookstore Starter

A small bookstore API built with Express and SQLite, plus a plain HTML/CSS/JS
frontend. One Express app serves both, so the UI and the API run as one service
on one port. Prometheus metrics are served on a second, metrics-only port.

Placing an order calls a second service, the **payment service**
(`../payment-service`), over HTTP. To run both together locally, use
`docker compose up -d --build` from the repo root.


## Quick start

```bash
npm install
npm start          # runs src/server.js → http://localhost:3000, metrics on :9464
npm run dev        # same, restarts on file changes
npm test           # runs the test suite with Node's built-in test runner
```

Requires Node 22 or later. Dependencies:

- `express`: web framework
- `better-sqlite3`: SQLite database
- `prom-client`: Prometheus metrics at `/metrics` on the metrics port
- `pino`: structured JSON logger. OpenTelemetry can later add trace ids to its lines automatically.
- `pino-http`: Express middleware that writes one pino log line per request

Without the payment service running, browsing works but placing an order
returns **503** ("Payment service is unavailable"). Start it with
`cd ../payment-service && npm install && METRICS_PORT=9465 npm start`, or use
docker compose. Both services default to metrics port 9464, so on one machine
one of them needs a different `METRICS_PORT`; otherwise the second one exits
at startup (see [Ports](#ports)).

### Running both services with docker compose

From the repo root:

```bash
docker compose up -d --build    # bookstore on :3000, metrics on :9464 and :9465
docker compose logs -f          # both services' JSON logs
docker compose down             # stop (the bookstore_data volume keeps your orders)
```

`docker-compose.yml` is for local development only. Jenkins and
`scripts/deploy.sh` don't use it. The payment service's port 4000 is not
published: the bookstore reaches it by name over the compose network.

## Ports

| Port | Served by | Who should be able to reach it |
| ---- | --------- | ------------------------------ |
| `3000` (`PORT`; published as 80 on EC2) | The public app: frontend, API, `/health` | Everyone (shoppers, `deploy.sh`'s smoke test) |
| `9464` (`METRICS_PORT`) | Metrics only: `GET /metrics`, every other path is a JSON 404 | The monitoring server only (security group) |

`GET /metrics` on the public port is an ordinary 404. Both listeners share one
metrics registry, so the metrics port reports the public app's requests.
Requests to the metrics port are not counted in the http metrics and not logged.

**If either port can't be opened** (for example, it's already in use), the
process logs a `fatal` line and exits with code 1. It never runs without its
metrics port, because `deploy.sh`'s smoke test only checks `/health` on the
public port and wouldn't notice.

## Configuration

Settings come from environment variables. Each one has a default.

| Variable  | Default               | Description                                         |
| --------- | --------------------- | --------------------------------------------------- |
| `PORT`    | `3000`                | Port the public app listens on                      |
| `METRICS_PORT` | `9464`           | Metrics-only port (`GET /metrics`), on all interfaces (0.0.0.0) |
| `DB_PATH` | `./data/bookstore.db` | SQLite database file, relative to where you start the server. Use `:memory:` for a throwaway in-memory database. |
| `PAYMENT_URL` | `http://localhost:4000` | Base URL of the payment service. In Docker, use the payment container's name, e.g. `http://payment-service:4000`. |
| `PAYMENT_TIMEOUT_MS` | `2000` | How long an order waits for the payment service before giving up with a 504 |
| `LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info` or `debug`. The tests use `silent`. |

The folder for `DB_PATH` (`data/` by default) is created automatically if it
doesn't exist. `data/` is in `.gitignore`.

```bash
PORT=8080 DB_PATH=/tmp/books.db npm start               # macOS / Linux / Git Bash
$env:PORT=8080; $env:DB_PATH="C:\temp\books.db"; npm start  # PowerShell
```

## Database

`src/store.js` is the only module that touches the database. It exposes the
functions the routes call (`listBooks`, `findBook`, `createOrder`, `listOrders`,
`findOrder`), so the route handlers don't need to know about SQL.

- **Tables.** `books (id, title, author, price, stock)` and
  `orders (id, book_id, title, quantity, unit_price, total, created_at)`.
  They are created on startup if missing.
- **Seed data.** The five starter books, including one with zero stock, are
  inserted only when the `books` table is empty. Restarting the server keeps
  your existing stock and orders.
- **Placing an order** decrements stock and inserts the order in a single
  transaction, so either both happen or neither does. The stock update only
  succeeds if enough stock is left, so stock can never go negative.
- To reset to the seed data, stop the server and delete the `data/` folder.

## Project layout

```
src/
  server.js            entry point for "npm start": reads config, starts BOTH listeners, logs crashes
  app.js               createApp({ store, paymentClient, config }): ONLY wires the pieces below together
  metricsApp.js        createMetricsApp(registry): the metrics-only app (GET /metrics, else 404)
  config.js            reads env vars (PORT, METRICS_PORT, DB_PATH, PAYMENT_URL, PAYMENT_TIMEOUT_MS, LOG_LEVEL)
  store.js             SQLite access: schema, seeding, queries, the order transaction
  logger.js            the shared pino logger (JSON lines, service "bookstore")
  metrics.js           Prometheus registry + metric definitions
  requestLabels.js     "/books/:id"-style route label and 499 status, shared by metrics and logs
  clients/
    paymentClient.js   calls POST /payments on the payment service (fetch + timeout)
  middleware/
    requestMetrics.js  records http_requests_total / http_request_duration_seconds
    requestLogger.js   one JSON log line per request (pino-http)
    notFound.js        JSON 404 for unknown routes
    errorHandler.js    JSON errors; logs unexpected ones with their stack
  routes/
    health.js          GET /health
    books.js           GET /books, GET /books/:id
    orders.js          GET /orders, GET /orders/:id, POST /orders (with the payment step)
    testing.js         POST /request-books: intentional 500, TEST ONLY, remove later
public/
  index.html  the frontend page, served at "/"
  styles.css
  app.js      frontend logic (vanilla JS + fetch)
tests/
  app.test.js             API and frontend tests (payments always approved via a fake client)
  orders-payment.test.js  POST /orders when payment is approved / fails (fake client, no network)
  paymentClient.test.js   the real payment client against a stand-in server on 127.0.0.1
  helpers/fakePaymentClient.js
data/         SQLite database file (created at runtime, git-ignored)
docs/         reserved for documentation
monitoring/   reserved for monitoring config
```

Why it's split up this way: each file does one job, so when you add
OpenTelemetry, a new route or a new metric, you know which file to open, and
`app.js` reads as a table of contents. Everything `createApp` needs (store,
payment client, config) can be passed in, which is how the tests swap in an
in-memory database and a fake payment client.

## API

All responses are JSON. Errors look like `{ "error": "message" }`. These are
on the public port (3000). `/metrics` is on the metrics port; see [Metrics](#metrics).

| Method | Path          | Description                          |
| ------ | ------------- | ------------------------------------ |
| GET    | `/health`     | `{ "status": "ok", "uptime": 12 }`   |
| GET    | `/books`      | List all books                       |
| GET    | `/books/:id`  | One book, or 404                     |
| GET    | `/orders`     | All orders                           |
| GET    | `/orders/:id` | One order, or 404                    |
| POST   | `/orders`     | Place an order (charges the payment service) |
| POST   | `/request-books` | **Test only:** always fails with 500, to test the error-rate alert. Remove later. |

`/health` only checks the bookstore itself. It doesn't call the payment
service, so a payment outage doesn't fail a bookstore deploy.

A book looks like `{ "id": 1, "title": "...", "author": "...", "price": 42.5, "stock": 5 }`.

### POST /orders

Request body:

```json
{ "bookId": 1, "quantity": 2 }
```

| Status | When                                                        |
| ------ | ----------------------------------------------------------- |
| 201    | Order created. Stock goes down by `quantity`.               |
| 400    | `bookId` or `quantity` missing or not a positive integer, or the body isn't valid JSON |
| 404    | No book with that `bookId`                                  |
| 409    | Not enough stock for the requested quantity                 |
| 502    | The payment service answered with an error (e.g. a 500)     |
| 503    | The payment service can't be reached (down, wrong `PAYMENT_URL`) |
| 504    | The payment service didn't answer within `PAYMENT_TIMEOUT_MS` |

### The order → payment flow

```
POST /orders
  1. validate bookId and quantity ............ 400 if invalid
  2. find the book ........................... 404 if missing
  3. check stock ............................. 409 if not enough
  4. POST {PAYMENT_URL}/payments
       { amount: price × quantity, bookId, quantity }
       ├─ 2xx approved ...................... continue
       ├─ 5xx (or any non-approval) ......... 502 { "error": "Payment service failed to process the payment" }
       ├─ can't connect ..................... 503 { "error": "Payment service is unavailable" }
       └─ no answer in PAYMENT_TIMEOUT_MS ... 504 { "error": "Payment service timed out" }
  5. create the order (stock − quantity + insert, one transaction)
  6. 201 with the order
```

- **Stock is checked before paying**, so a sold-out book never costs a payment call.
- **A failed payment changes nothing:** no order, and stock stays the same.
- **Why 502/503/504 and not 500?** All three are 5xx, so the error-rate alert
  counts them. But they say *a dependency failed*, while 500 says *the bookstore
  itself has a bug*, so a dashboard can tell the two apart.
- **Rare race:** if another order takes the last copies while we wait for the
  payment, the order transaction fails with the usual 409, but the payment was
  approved. A real system would refund it (or reserve stock first). This project
  just logs a `warn` line with the `paymentId` and returns the 409.
- **A timeout doesn't mean the payment failed.** After a 504, the payment
  service may still finish and approve the payment, so the shopper gets charged
  with no order. You can see this in the `PAYMENT_DELAY_MS=3000` test. Real
  systems use idempotency keys and reconciliation; this project only documents it.
- The client (`src/clients/paymentClient.js`) uses Node's built-in `fetch` with
  `AbortSignal.timeout`. One timeout covers connecting, waiting and reading the
  response.

A created order looks like:

```json
{ "id": 1, "bookId": 1, "title": "The Pragmatic Programmer", "quantity": 2,
  "unitPrice": 42.5, "total": 85, "createdAt": "2026-11-14T18:30:00.000Z" }
```

## Metrics

`GET /metrics` on the metrics port, `METRICS_PORT` (default 9464), in
Prometheus format. It is not available on the public port (see [Ports](#ports)).
Dashboards depend on these names, labels and buckets, so don't change them:

| Metric | Type | Labels |
| ------ | ---- | ------ |
| `http_requests_total` | counter | `method`, `route`, `status` |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` |
| `payment_client_request_duration_seconds` | histogram | `outcome` = `approved` / `error` / `timeout` / `unreachable` |

- **Buckets.** Both histograms use `[0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]` seconds.
- **Route labels.** `route` is the route *pattern* (`/books/:id`, never `/books/1`).
  Requests that match no route are labelled `static` (frontend files),
  `not_found`, or `unmatched` (for example a malformed JSON body).
- **What isn't counted.** Anything sent to the metrics port, including the
  scrapes themselves. A `GET /metrics` on the *public* port is a normal 404 and
  is counted as `route="not_found", status="404"`, so probes show up.
- **Status 499.** If the caller disconnects before the response is sent, the
  request is still counted and logged, with `status="499"` (nginx's "client
  closed request"). Otherwise slow requests whose caller gave up would vanish
  from the latency metrics.
- **Payment timing from both sides.** `payment_client_request_duration_seconds`
  is the payment call as the bookstore experienced it. Compare it with the
  payment service's own `http_request_duration_seconds` to see time lost
  between the two services.

## Logs

Everything is logged as one JSON object per line on stdout (pino), ready for
`docker logs` and CloudWatch. There is no `console.log` anywhere.

```json
{"level":"info","time":"2026-11-23T10:00:00.010Z","service":"bookstore","outcome":"approved","durationMs":4,"paymentId":"3f2c…","amount":85,"bookId":1,"quantity":2,"msg":"payment call"}
{"level":"info","time":"2026-11-23T10:00:00.012Z","service":"bookstore","reqId":7,"method":"POST","route":"/orders","status":201,"durationMs":6,"msg":"request completed"}
```

- **Every request** gets one line with `method`, `route` (the pattern),
  `status` and `durationMs`. The level is `error` for 5xx, `warn` for 4xx and
  `info` otherwise. Requests to the metrics port (Prometheus scrapes) aren't logged.
- **Startup** logs one line per listener: `app listening on 3000` and
  `metrics listening on 9464`. If either can't start, a `fatal` line is logged
  and the process exits with code 1.
- **Every payment call** gets a `"msg":"payment call"` line with `outcome`
  and `durationMs`. Failures are logged at `warn`, with a `reason`.
- **Unexpected errors** (500s) get an `"msg":"unexpected error"` line at
  `error`, with `err.type`, `err.message` and `err.stack`.
- **Tests** set `LOG_LEVEL=silent`.

## Frontend

The frontend lives in `public/` and is served by `express.static`, so opening
`http://localhost:3000/` loads it. It is plain HTML, CSS and vanilla JavaScript:
no framework, no bundler, no build step and no extra npm packages. Because the
page and the API share an origin, there is no CORS setup.

What the page does:

- **API status.** A badge in the header calls `GET /health` and shows "API ok"
  in green, or "API unreachable" in red.
- **Book list.** Calls `GET /books` and shows each book's title, author, price
  and current stock. Low stock (2 or fewer) is shown in amber and sold-out
  books in red.
- **Order form.** Pick a book, enter a quantity and submit. The page sends
  `POST /orders` and shows either the created order (order number, book,
  quantity, unit price, total, time) or the API's error message with its
  status code (400, 404, 409, or 502/503/504 when the payment service fails,
  shown as "Something went wrong on our end. Your order was not placed.").
- **Stock refresh.** After a successful order the page fetches `GET /books`
  again, so the list and the dropdown show the new stock. Counts that changed
  briefly pulse. The **Refresh** button reloads health and books by hand.

The page validates nothing itself; the API is the single source of truth. To
demo the error cases, order more copies than are in stock (409), order the
sold-out book (409), or clear the quantity field (400). For 502/504, turn up
the payment service's fault settings (see `../payment-service/README.md`).

Layout: two columns on a laptop (books on the left, order form on the right),
stacked on a phone. It follows the system light or dark mode.

### How the page calls the API

All requests go through one helper in `public/app.js`:

```js
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}
```

Paths are relative (`/health`, `/books`, `/orders`), so the browser sends them
to whichever host served the page. Any non-2xx response becomes a thrown
`Error` that carries the API's `error` message and the HTTP status, which the
order form displays.

## Tests

`npm test` runs every `tests/**/*.test.js` with Node's built-in test runner
(`node:test`), so there are no test dependencies. Each test file sets
`DB_PATH=:memory:` and `LOG_LEVEL=silent` before it loads `src/app.js`, and
every test gets its own freshly seeded in-memory database. Tests never create
a database file, never start `server.js`, and never need the payment service.

- **app.test.js:** `GET /` serves the HTML page, `/health`, `/books`,
  `/books/:id` (including 404), `/orders/:id` (including 404), `POST /orders`
  for 201, 400, 404 and 409, and the test route. A fake payment
  client that always approves is injected with `createApp({ paymentClient })`.
  Also the metrics split: `GET /metrics` on the main app is a 404, and the
  metrics app (`createMetricsApp(app.locals.metricsRegistry)` on its own random
  port) serves metrics, 404s every other path, shows the main app's requests,
  and doesn't count its own.
- **orders-payment.test.js:** fake clients for approved, 5xx → 502,
  unreachable → 503 and timeout → 504. Checks that a failed payment leaves
  stock and orders unchanged, and that an invalid or out-of-stock order never
  calls the payment service.
- **paymentClient.test.js:** the real client against a tiny stand-in HTTP
  server on `127.0.0.1`. Checks each outcome and the
  `payment_client_request_duration_seconds` metric.

## What the pipeline and deploy will need

The Jenkinsfile and `scripts/deploy.sh` haven't been changed yet. Until they
are, a deployed bookstore has no payment service to call, so **every order
would return 503**. Update them before (or together with) merging this.

1. **A second image.** Build and push `payment-service/` as its own image
   (e.g. `<registry>/payment-service:<git sha>`), alongside the bookstore image.
   Its tests run with `npm ci && npm test` inside `payment-service/`, just like `app/`.
2. **A shared Docker network on the EC2 host.** Create it once, e.g.
   `docker network create bookstore-net`, and start both containers with
   `--network bookstore-net`. On a user-defined network, containers find each
   other by container name.
3. **The payment container.** Name it `payment-service` and publish **only**
   its metrics port: `-p 9465:9464`. Do **not** publish 4000; only the
   bookstore talks to it, over the shared network. Start it *before* the
   bookstore. Fault settings (`PAYMENT_DELAY_MS`, `PAYMENT_DELAY_JITTER_MS`,
   `PAYMENT_FAILURE_RATE`) default to 0, so pass nothing in normal deploys.
4. **The bookstore container.** Same as today (`-p 80:3000`,
   `-v bookstore_data:/app/data`), plus `-p 9464:9464` (metrics),
   `--network bookstore-net` and `-e PAYMENT_URL=http://payment-service:4000`.
   Optionally set `-e PAYMENT_TIMEOUT_MS=2000`.
5. **Ports and security group.** Both containers listen for metrics on 9464
   inside; the host can't bind 9464 twice, so the payment service's metrics
   go on host port 9465.

   | Host port | Container | Serves | Reachable from |
   | --------- | --------- | ------ | -------------- |
   | 80 | bookstore:3000 | public app, `/health` | everyone (as today) |
   | 9464 | bookstore:9464 | bookstore `/metrics` | monitoring server only |
   | 9465 | payment-service:9464 | payment `/metrics` | monitoring server only |
   | (none) | payment-service:4000 | `POST /payments` | not published; Docker network only |

   The app server's security group needs two new **inbound** rules:
   - TCP **9464**, source = the **monitoring server's security group** (not a CIDR, not `0.0.0.0/0`)
   - TCP **9465**, source = the **monitoring server's security group**

   Remove any inbound rule for 4000 if one exists. Prometheus then scrapes
   `<app-server-private-ip>:9464` (job bookstore) and `:9465` (job payment-service).
6. **Health checks.** `deploy.sh` can check `curl http://localhost/health` as
   today. It doesn't need to check the metrics port: if that port can't open,
   the container exits (code 1), so the smoke test fails anyway. For the payment service, run
   `docker exec payment-service node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1))"`.
   The slim image has no curl.

**Non-root note.** The payment service image already runs as the `node` user.
The bookstore image still runs as root, because the existing `bookstore_data`
volume on the server holds root-owned files. To switch it to `USER node`,
first `chown -R node:node /app/data` in the Dockerfile, *and* fix ownership of
the existing volume once (e.g.
`docker run --rm -v bookstore_data:/data alpine chown -R 1000:1000 /data`).

## Notes

- Book 5 starts with zero stock, which makes it easy to show a 409 in a demo.
  Once you've sold out other books, delete `data/` to reset (with docker
  compose: `docker compose down -v`).
