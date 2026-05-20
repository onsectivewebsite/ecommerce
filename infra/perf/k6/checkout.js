// k6 checkout scenario.
//
// Requires pre-seeded test accounts; the script reads them from CSV via SharedArray.
// Targets: 50 RPS for 3m, p95 < 600ms.
//
// Run with:
//   TARGET=https://api.staging.onsective.com CREDS=infra/perf/k6/creds.csv \
//   k6 run infra/perf/k6/checkout.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { open } from 'k6/experimental/fs';

const TARGET = __ENV.TARGET || 'http://localhost:4000';
const CREDS_PATH = __ENV.CREDS || './creds.csv';

const creds = new SharedArray('creds', () => {
  const raw = open(CREDS_PATH);
  return raw.trim().split(/\r?\n/).slice(1).map((line) => {
    const [email, password, addressId, variantId] = line.split(',');
    return { email, password, addressId, variantId };
  });
});

export const options = {
  scenarios: {
    buyers: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 80,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.02'],
    http_req_duration: ['p(95)<600'],
  },
};

export default function () {
  const c = creds[Math.floor(Math.random() * creds.length)];
  let token = null;

  group('login', () => {
    const res = http.post(`${TARGET}/auth/login`, JSON.stringify({ email: c.email, password: c.password }), {
      headers: { 'Content-Type': 'application/json' },
    });
    if (check(res, { '200': (r) => r.status === 200 })) {
      token = res.json('accessToken');
    }
  });
  if (!token) return;

  group('add to cart', () => {
    http.post(`${TARGET}/cart/items`, JSON.stringify({ variantId: c.variantId, qty: 1 }), {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
  });

  group('checkout (mock)', () => {
    const res = http.post(`${TARGET}/orders/checkout`, JSON.stringify({
      shippingAddressId: c.addressId,
      paymentProvider: 'mock',
    }), { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const orderId = res.json('id');
    if (orderId) {
      http.post(`${TARGET}/payments/mock/capture/${orderId}`, null, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  sleep(Math.random() * 0.5);
}
