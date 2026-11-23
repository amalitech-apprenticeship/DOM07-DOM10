// HTTP client for the payment service. routes/orders.js calls charge() before
// creating an order. app.js builds the real client; tests inject a fake one
// with the same charge() method, so they never make network calls.
//
// charge() either resolves with { paymentId, status: "approved" } or throws a
// PaymentError whose "outcome" says what went wrong:
//   error        the payment service answered, but not with an approval (e.g. a 500)
//   unreachable  we couldn't connect at all (container down, wrong PAYMENT_URL)
//   timeout      no complete answer within PAYMENT_TIMEOUT_MS
// The route turns those into 502 / 503 / 504. Keeping the HTTP details here
// means the route only has to know about outcomes.
//
// Why built-in fetch (no axios): Node 22 has it, and OpenTelemetry can
// instrument it later to propagate trace context to the payment service.

class PaymentError extends Error {
  constructor(outcome, message, cause) {
    super(message, { cause });
    this.name = 'PaymentError';
    this.outcome = outcome;
  }
}

function createPaymentClient({ baseUrl, timeoutMs, metrics, logger }) {
  async function send(payment) {
    // One deadline for the whole exchange: connecting, waiting for headers and
    // reading the body. AbortSignal.timeout aborts with a "TimeoutError".
    const signal = AbortSignal.timeout(timeoutMs);
    let res;
    let body;
    try {
      res = await fetch(`${baseUrl}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payment),
        signal,
      });
      body = await res.json().catch(() => null);
    } catch (err) {
      if (err.name === 'TimeoutError') {
        throw new PaymentError('timeout', `Payment service did not answer within ${timeoutMs} ms`, err);
      }
      // fetch reports connection problems (ECONNREFUSED, ENOTFOUND, ...) as
      // "TypeError: fetch failed" with the real reason in err.cause.
      const reason = (err.cause && err.cause.code) || err.message;
      throw new PaymentError('unreachable', `Could not reach the payment service (${reason})`, err);
    }

    if (res.status >= 200 && res.status < 300 && body && body.status === 'approved' && body.paymentId) {
      return { paymentId: body.paymentId, status: body.status };
    }
    // A 4xx also lands here: it means the bookstore sent a bad request,
    // which is our bug, not the shopper's, so it is treated like a 5xx.
    const detail = body && body.error ? `: ${body.error}` : '';
    throw new PaymentError('error', `Payment service responded with ${res.status}${detail}`);
  }

  async function charge(payment) {
    const endTimer = metrics.paymentClientDuration.startTimer();
    const started = performance.now();
    try {
      const result = await send(payment);
      endTimer({ outcome: 'approved' });
      logger.info(
        { outcome: 'approved', durationMs: Math.round(performance.now() - started), paymentId: result.paymentId, ...payment },
        'payment call'
      );
      return result;
    } catch (err) {
      const outcome = err instanceof PaymentError ? err.outcome : 'error';
      endTimer({ outcome });
      // warn, not error: the bookstore handles this on purpose (502/503/504),
      // so no stack trace is needed, just what happened and how long it took.
      logger.warn(
        { outcome, durationMs: Math.round(performance.now() - started), reason: err.message, ...payment },
        'payment call'
      );
      throw err;
    }
  }

  return { charge };
}

module.exports = { createPaymentClient, PaymentError };
