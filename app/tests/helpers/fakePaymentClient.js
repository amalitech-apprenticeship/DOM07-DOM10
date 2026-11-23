// Fake payment clients for tests. They have the same charge() method as
// src/clients/paymentClient.js but never touch the network, so tests are fast
// and don't need the payment service running.
// Each fake records what it was asked to charge in `.calls`.

const { PaymentError } = require('../../src/clients/paymentClient');

// Always approves.
function approvedPaymentClient() {
  const calls = [];
  let n = 0;
  return {
    calls,
    async charge(payment) {
      calls.push(payment);
      n += 1;
      return { paymentId: `fake-payment-${n}`, status: 'approved' };
    },
  };
}

// Always fails with the given outcome: 'error' | 'unreachable' | 'timeout'.
function failingPaymentClient(outcome) {
  const calls = [];
  return {
    calls,
    async charge(payment) {
      calls.push(payment);
      throw new PaymentError(outcome, `fake payment failure (${outcome})`);
    },
  };
}

module.exports = { approvedPaymentClient, failingPaymentClient };
