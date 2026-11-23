// Fault injection: decides how long each payment waits and whether it fails.
// Used by the POST /payments handler in app.js.
//
// Why this exists: to test dashboards and alerts you need slow requests and
// errors on demand. Instead of special "break me" routes, you turn these
// settings up (PAYMENT_DELAY_MS, PAYMENT_DELAY_JITTER_MS, PAYMENT_FAILURE_RATE)
// and real orders become slow or fail, then turn them back to 0.
//
// `random` is injectable (defaults to Math.random) so tests can make
// "random" decisions predictable.

function createFaults({ delayMs, delayJitterMs, failureRate }, random = Math.random) {
  return {
    // Fixed delay plus a random 0..jitter extra, in whole ms.
    // Only draws a random number when jitter is on, so with no jitter the
    // failure decision below gets the next draw (keeps tests predictable).
    delay() {
      const jitter = delayJitterMs > 0 ? random() * delayJitterMs : 0;
      return Math.round(delayMs + jitter);
    },
    // random() is in [0, 1), so rate 0 never fails and rate 1 always fails.
    shouldFail() {
      return random() < failureRate;
    },
  };
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

module.exports = { createFaults, sleep };
